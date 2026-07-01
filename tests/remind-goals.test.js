import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReminderText,
  extractGoal,
  getJstWeekStart,
  normalizeSlackText,
} from "../scripts/remind-goals.js";

test("getJstWeekStart returns Monday 00:00 JST as UTC time", () => {
  const weekStart = getJstWeekStart(new Date("2026-07-01T08:00:00+09:00"));

  assert.equal(weekStart.toISOString(), "2026-06-28T15:00:00.000Z");
});

test("extractGoal normalizes a plain goal reply", () => {
  assert.equal(extractGoal("  ・英単語を100個覚えるする。 "), "英単語を100個覚えるする");
});

test("normalizeSlackText keeps user mentions comparable", () => {
  assert.equal(normalizeSlackText("&lt;@U123&gt; hello"), "<@U123> hello");
});

test("buildReminderText mentions every user in one channel post", () => {
  assert.equal(
    buildReminderText([
      { user: "U111", goal: "提案書を作成する" },
      { user: "U222", goal: "テストを書く" },
    ]),
    "<@U111> 今週の目標は「提案書を作成する」です\n<@U222> 今週の目標は「テストを書く」です",
  );
});
