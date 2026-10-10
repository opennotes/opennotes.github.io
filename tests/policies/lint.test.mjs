import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ESLint, RuleTester } from "eslint";

import config from "../../eslint.config.js";
import { maxTestLines } from "../../scripts/lint-rules.mjs";

const rules = config.find((item) => item.plugins?.opennotes).plugins.opennotes.rules;
RuleTester.describe = describe;
RuleTester.it = test;

const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });

tester.run("multiline-array", rules["multiline-array"], {
  valid: ["const items = [1, 2];", "const items = [\n1,\n2,\n3,\n];"],
  invalid: [{ code: "const items = [1, 2, 3];", errors: [{ messageId: "multiline" }] }],
});
tester.run("multiline-return-object", rules["multiline-return-object"], {
  valid: [
    "function result() { return { value: true }; }",
    "function result() { return {\nfirst: 1,\nsecond: 2,\n}; }",
  ],
  invalid: [
    {
      code: "function result() { return { first: 1, second: 2 }; }",
      output: "function result() { return {\n first: 1, \nsecond: 2 \n}; }",
      errors: [{ messageId: "multiline" }],
    },
  ],
});
tester.run("max-test-lines", maxTestLines, {
  valid: [
    {
      code: 'import {it} from "vitest"; it("short", () => {\n const value = 1;\n console.log(value);\n});',
      options: [{ max: 4 }],
    },
  ],
  invalid: [
    {
      code: 'import {it} from "vitest"; it("long", () => {\n const value = 1;\n console.log(value);\n});',
      options: [{ max: 3 }],
      errors: [{ messageId: "long" }],
    },
  ],
});

test("source, test and architecture rules are active", async () => {
  const eslint = new ESLint();
  const source = await eslint.calculateConfigForFile("src/js/files/project.js");
  const unit = await eslint.calculateConfigForFile("tests/unit/reader.test.js");
  const css = await import("../../stylelint.config.js");
  assert.equal(source.rules["complexity"][1], 12);
  assert.equal(source.rules["jsdoc/require-description"][0], 2);
  assert.equal(unit.rules["vitest/no-focused-tests"][0], 2);
  assert.ok(css.default.extends.includes("stylelint-config-recess-order"));
});
test("file operations cannot import interface controllers", async () => {
  const eslint = new ESLint();
  const [report] = await eslint.lintText(
    'import WorkspaceController from "../controllers/workspace_controller.js";\nexport {WorkspaceController};\n',
    { filePath: "src/js/files/architecture-probe.js" },
  );
  assert.ok(report.messages.some((message) => message.ruleId === "import-x/no-restricted-paths"));
});
