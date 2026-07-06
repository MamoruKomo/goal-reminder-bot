const SLACK_API_BASE_URL = "https://slack.com/api";
const NOTION_API_BASE_URL = "https://api.notion.com/v1";

const CONFIG = {
  channelId: process.env.SLACK_CHANNEL_ID || "C0AUQNCULMB",
  mondayMessageMarker:
    process.env.MONDAY_MESSAGE_MARKER ||
    "今週の目標をスレッドに投稿してください",
  expectedReplyCount: Number(process.env.EXPECTED_REPLY_COUNT || "3"),
  dryRun: process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true",
  now: process.env.NOW ? new Date(process.env.NOW) : new Date(),
  notionToken: process.env.NOTION_TOKEN,
  notionDataSourceId:
    process.env.NOTION_DATA_SOURCE_ID ||
    "39509a68-050b-80a0-966f-000ba6c187f4",
  notionApiVersion: process.env.NOTION_API_VERSION || "2025-09-03",
  notionSyncJstDays: parseNumberList(process.env.NOTION_SYNC_JST_DAYS || "2"),
  notionStatus: process.env.NOTION_STATUS || "まだ手つけてないよ",
  notionCategory: process.env.NOTION_CATEGORY || "その他",
  failOnNotionError:
    process.env.FAIL_ON_NOTION_ERROR === "1" ||
    process.env.FAIL_ON_NOTION_ERROR === "true",
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

function parseNumberList(value) {
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
}

function getJstDay(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
}

function getJstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function getJstWeekEndDateString(date = new Date()) {
  const weekStart = getJstWeekStart(date);
  return getJstDateString(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000));
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

function buildNotionTaskTitle(goal) {
  return `今週の目標: ${goal}`;
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
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  );
  const url = new URL(`${SLACK_API_BASE_URL}/${method}`);
  const request =
    method === "conversations.replies"
      ? {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(cleanParams),
        };

  if (request.method === "GET") {
    for (const [key, value] of Object.entries(cleanParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, request);

  const data = await response.json();
  if (!response.ok || !data.ok) {
    const responseMessages = data.response_metadata?.messages?.join("; ");
    const detail = [data.error || `${response.status} ${response.statusText}`, responseMessages]
      .filter(Boolean)
      .join(" - ");
    throw new Error(`Slack API ${method} failed: ${detail}`);
  }
  return data;
}

async function notionApi(config, method, path, body = {}) {
  const response = await fetch(`${NOTION_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": config.notionApiVersion,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data.message || data.code || `${response.status} ${response.statusText}`;
    throw new Error(`Notion API ${method} ${path} failed: ${detail}`);
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

async function notionTaskExists(config, { title, dueDate }) {
  const data = await notionApi(
    config,
    "POST",
    `/data_sources/${config.notionDataSourceId}/query`,
    {
      page_size: 1,
      filter: {
        and: [
          {
            property: "やること",
            title: {
              equals: title,
            },
          },
          {
            property: "いつまでにやるの？",
            date: {
              equals: dueDate,
            },
          },
        ],
      },
    },
  );

  return (data.results || []).length > 0;
}

async function createNotionTask(config, { title, user, goal, dueDate, threadTs }) {
  await notionApi(config, "POST", "/pages", {
    parent: {
      type: "data_source_id",
      data_source_id: config.notionDataSourceId,
    },
    properties: {
      やること: {
        title: [
          {
            text: {
              content: title,
            },
          },
        ],
      },
      ステータス: {
        select: {
          name: config.notionStatus,
        },
      },
      種別: {
        select: {
          name: config.notionCategory,
        },
      },
      "いつまでにやるの？": {
        date: {
          start: dueDate,
        },
      },
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `Slack user: ${user}`,
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `Slack goal: ${goal}`,
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `Source thread timestamp: ${threadTs}`,
              },
            },
          ],
        },
      },
    ],
  });
}

async function syncNotionGoals(config, goals, threadTs) {
  if (!config.notionToken) {
    console.log("Notion sync skipped: NOTION_TOKEN is not set.");
    return;
  }

  if (!config.notionDataSourceId) {
    console.log("Notion sync skipped: NOTION_DATA_SOURCE_ID is not set.");
    return;
  }

  const jstDay = getJstDay(config.now);
  if (!config.notionSyncJstDays.includes(jstDay)) {
    console.log(`Notion sync skipped: JST day ${jstDay} is not configured.`);
    return;
  }

  const dueDate = getJstWeekEndDateString(config.now);
  let created = 0;
  let skipped = 0;

  for (const { user, goal } of goals) {
    const title = buildNotionTaskTitle(goal);
    if (await notionTaskExists(config, { title, dueDate })) {
      skipped += 1;
      continue;
    }

    if (config.dryRun) {
      console.log(`[dry-run] Would create Notion task: ${title}`);
      skipped += 1;
      continue;
    }

    await createNotionTask(config, {
      title,
      user,
      goal,
      dueDate,
      threadTs,
    });
    created += 1;
  }

  console.log(`Notion sync complete: created=${created}, skipped=${skipped}.`);
}

async function syncNotionGoalsSafely(config, goals, threadTs) {
  try {
    await syncNotionGoals(config, goals, threadTs);
  } catch (error) {
    if (config.failOnNotionError) {
      throw error;
    }
    console.error(error);
    console.log("Notion sync failed, but Slack reminder will continue.");
  }
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

  if (config.dryRun) {
    console.log(reminderText);
    await syncNotionGoalsSafely(config, goals, rootMessage.ts);
    return;
  }

  await syncNotionGoalsSafely(config, goals, rootMessage.ts);

  if (await hasAlreadyPostedToday(config.channelId, reminderText, config.now)) {
    console.log("Reminder was already posted today.");
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
  buildNotionTaskTitle,
  buildReminderText,
  extractGoal,
  getJstDateString,
  getJstDay,
  getJstWeekStart,
  getJstWeekEndDateString,
  normalizeSlackText,
  parseNumberList,
};
