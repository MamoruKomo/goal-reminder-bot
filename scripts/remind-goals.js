const SLACK_API_BASE_URL = "https://slack.com/api";

const CONFIG = {
  channelId: process.env.SLACK_CHANNEL_ID || "C0AUQNCULMB",
  mondayMessageMarker:
    process.env.MONDAY_MESSAGE_MARKER ||
    "今週の目標をスレッドに投稿してください",
  expectedReplyCount: Number(process.env.EXPECTED_REPLY_COUNT || "3"),
  dryRun: process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true",
  now: process.env.NOW ? new Date(process.env.NOW) : new Date(),
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getJstWeekStart(date = new Date()) {
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = jstDate.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const mondayJst = new Date(
    Date.UTC(
      jstDate.getUTCFullYear(),
      jstDate.getUTCMonth(),
      jstDate.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
      0,
    ),
  );
  return new Date(mondayJst.getTime() - 9 * 60 * 60 * 1000);
}

function seconds(date) {
  return Math.floor(date.getTime() / 1000).toString();
}

function normalizeSlackText(text) {
  return String(text || "")
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, "$1")
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, "$1")
    .replace(/<([@#][^>|]+)(?:\|[^>]+)?>/g, "<$1>")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGoal(text) {
  return normalizeSlackText(text)
    .replace(/^[-*・\s]+/, "")
    .replace(/^今週の目標[は:：\s]*/, "")
    .replace(/[。.\s]+$/, "")
    .trim();
}

function buildReminderText(goals) {
  return goals
    .map(({ user, goal }) => `<@${user}> 今週の目標は「${goal}」です`)
    .join("\n");
}

function isReportableReply(message) {
  return Boolean(
    message &&
      message.user &&
      !message.subtype &&
      extractGoal(message.text).length > 0,
  );
}

async function slackApi(method, params = {}) {
  const token = requireEnv("SLACK_BOT_TOKEN");
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    const detail = data.error || `${response.status} ${response.statusText}`;
    throw new Error(`Slack API ${method} failed: ${detail}`);
  }
  return data;
}

async function getAllPages(method, params, itemKey) {
  const items = [];
  let cursor;
  do {
    const data = await slackApi(method, { ...params, cursor });
    items.push(...(data[itemKey] || []));
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);
  return items;
}

async function findMondayGoalMessage({ channelId, marker, now }) {
  const weekStart = getJstWeekStart(now);
  const messages = await getAllPages(
    "conversations.history",
    {
      channel: channelId,
      oldest: seconds(weekStart),
      latest: seconds(now),
      inclusive: true,
      limit: 200,
    },
    "messages",
  );

  return messages
    .filter((message) => normalizeSlackText(message.text).includes(marker))
    .sort((a, b) => Number(b.ts) - Number(a.ts))[0];
}

async function getThreadReplies(channelId, threadTs) {
  return getAllPages(
    "conversations.replies",
    {
      channel: channelId,
      ts: threadTs,
      limit: 200,
    },
    "messages",
  );
}

async function hasAlreadyPostedToday(channelId, reminderText, now) {
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStartJst = new Date(
    Date.UTC(
      jstDate.getUTCFullYear(),
      jstDate.getUTCMonth(),
      jstDate.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const todayStartUtc = new Date(todayStartJst.getTime() - 9 * 60 * 60 * 1000);
  const messages = await getAllPages(
    "conversations.history",
    {
      channel: channelId,
      oldest: seconds(todayStartUtc),
      latest: seconds(now),
      inclusive: true,
      limit: 200,
    },
    "messages",
  );

  return messages.some(
    (message) => normalizeSlackText(message.text) === normalizeSlackText(reminderText),
  );
}

async function run(config = CONFIG) {
  const rootMessage = await findMondayGoalMessage({
    channelId: config.channelId,
    marker: config.mondayMessageMarker,
    now: config.now,
  });

  if (!rootMessage) {
    console.log("No Monday goal thread found for this week.");
    return;
  }

  const replies = await getThreadReplies(config.channelId, rootMessage.ts);
  const goals = replies
    .filter((message) => message.ts !== rootMessage.ts)
    .filter(isReportableReply)
    .slice(0, config.expectedReplyCount)
    .map((message) => ({
      user: message.user,
      goal: extractGoal(message.text),
    }));

  if (goals.length === 0) {
    console.log("No goal replies found yet.");
    return;
  }

  const reminderText = buildReminderText(goals);

  if (await hasAlreadyPostedToday(config.channelId, reminderText, config.now)) {
    console.log("Reminder was already posted today.");
    return;
  }

  if (config.dryRun) {
    console.log(reminderText);
    return;
  }

  await slackApi("chat.postMessage", {
    channel: config.channelId,
    text: reminderText,
    unfurl_links: false,
    unfurl_media: false,
  });

  console.log(`Posted ${goals.length} goal reminder(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  buildReminderText,
  extractGoal,
  getJstWeekStart,
  normalizeSlackText,
};
