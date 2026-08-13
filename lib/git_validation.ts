import type { GitPolicy } from "./git_policy";

export type GitValidationIssue = {
  code:
    | "EMPTY_BRANCH_NAME"
    | "INVALID_BRANCH_GRAMMAR"
    | "DISALLOWED_BRANCH_TYPE"
    | "INVALID_BRANCH_SUMMARY"
    | "EMPTY_COMMIT_MESSAGE"
    | "SUBJECT_WHITESPACE"
    | "SUBJECT_CASE"
    | "SUBJECT_TRAILING_PERIOD"
    | "FORBIDDEN_COMMIT_PREFIX";
  message: string;
};

export type GitValidationResult = {
  valid: boolean;
  issues: GitValidationIssue[];
};

export type CommitMessageValidationResult =
  GitValidationResult & {
    subject: string;
    body_present: boolean;
    semantic_review: string[];
  };

const kebabCaseSummary =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function result(
  issues: GitValidationIssue[],
): GitValidationResult {
  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateWorkingBranchName(
  branchName: string,
  policy: GitPolicy,
): GitValidationResult {
  const issues: GitValidationIssue[] = [];

  if (branchName.length === 0) {
    issues.push({
      code: "EMPTY_BRANCH_NAME",
      message: "Branch name must not be empty",
    });

    return result(issues);
  }

  const parts = branchName.split("/");

  if (parts.length !== 2) {
    issues.push({
      code: "INVALID_BRANCH_GRAMMAR",
      message:
        `Branch name must match ${policy.branch.format}`,
    });

    return result(issues);
  }

  const [branchType = "", summary = ""] = parts;

  if (!policy.branch.allowed_types.includes(branchType)) {
    issues.push({
      code: "DISALLOWED_BRANCH_TYPE",
      message:
        `Branch type ${JSON.stringify(branchType)} is not allowed`,
    });
  }

  if (!kebabCaseSummary.test(summary)) {
    issues.push({
      code: "INVALID_BRANCH_SUMMARY",
      message:
        "Branch summary must use lowercase kebab case",
    });
  }

  return result(issues);
}

function firstLetter(value: string): string | null {
  return value.match(/\p{L}/u)?.[0] ?? null;
}

function isUppercaseLetter(value: string): boolean {
  return (
    value === value.toUpperCase() &&
    value !== value.toLowerCase()
  );
}

export function validateCommitMessage(
  message: string,
  policy: GitPolicy,
): CommitMessageValidationResult {
  const issues: GitValidationIssue[] = [];

  if (message.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "EMPTY_COMMIT_MESSAGE",
          message: "Commit message must not be empty",
        },
      ],
      subject: "",
      body_present: false,
      semantic_review: [],
    };
  }

  const lines = message.split(/\r?\n/);
  const subject = lines[0] ?? "";
  const body = lines.slice(1).join("\n");
  const bodyPresent = body.trim().length > 0;

  if (subject.trim().length === 0) {
    issues.push({
      code: "EMPTY_COMMIT_MESSAGE",
      message: "Commit subject must not be empty",
    });
  }

  if (subject !== subject.trim()) {
    issues.push({
      code: "SUBJECT_WHITESPACE",
      message:
        "Commit subject must not have leading or trailing whitespace",
    });
  }

  if (
    policy.commit_message.trailing_period === false &&
    subject.endsWith(".")
  ) {
    issues.push({
      code: "SUBJECT_TRAILING_PERIOD",
      message:
        "Commit subject must not end with a period",
    });
  }

  if (policy.commit_message.subject_case === "sentence") {
    const letter = firstLetter(subject);

    if (letter === null || !isUppercaseLetter(letter)) {
      issues.push({
        code: "SUBJECT_CASE",
        message:
          "Commit subject must begin with an uppercase letter",
      });
    }
  }

  for (
    const pattern of
      policy.commit_message.forbidden_prefix_patterns
  ) {
    if (new RegExp(pattern).test(subject)) {
      issues.push({
        code: "FORBIDDEN_COMMIT_PREFIX",
        message:
          "Commit subject uses a prohibited categorical prefix",
      });

      break;
    }
  }

  const semanticReview = [
    "Confirm that the subject clearly describes the actual coherent change",
    "Confirm that the subject is descriptive rather than generic",
  ];

  if (bodyPresent) {
    semanticReview.push(
      "Confirm that the body adds material information rather than repeating the subject",
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    subject,
    body_present: bodyPresent,
    semantic_review: semanticReview,
  };
}
