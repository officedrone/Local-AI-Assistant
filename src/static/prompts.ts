// src/static/prompts.ts

//
// Code Validation, Completion & Chat Prompts
//

/**
 * Calculate the maximum allowed <think> tokens based on context size.
 * Defaults to 4096 if contextSize is missing/invalid.
 * Uses 1/5 of context size, floored to an integer, with a minimum of 1.
 */
const getMaxThinkTokens = (contextSize?: number): number => {
  const safeContextSize =
    Number.isFinite(contextSize) && contextSize! > 0 ? contextSize! : 4096;
  return Math.max(1, Math.floor(safeContextSize / 5));
};

/**
 * Utility: format one or more file contexts into a single string.
 * Updated to use summary + slices instead of full content.
 */
export function formatFileContexts(
  contexts?: {
    uri: string;
    language: string;
    summary: string;
    slices: {
      startLine: number;
      endLine: number;
      lines: { n: number; text: string }[];
    }[];
  }[]
): string | undefined {
  if (!contexts || contexts.length === 0) return undefined;

  return contexts
    .map((f) => {
      let out = `// File: ${f.uri}\nSummary:\n${f.summary.trim()}\n`;

      for (const slice of f.slices) {
        out += `\nSlice ${slice.startLine}-${slice.endLine}:\n\`\`\`${f.language}\n`;
        for (const line of slice.lines) {
          out += `${line.n}: ${line.text}\n`;
        }
        out += `\`\`\`\n`;
      }

      return out;
    })
    .join('\n\n');
}

function buildThinkInstructions(contextSize?: number) {
  return `
When reasoning, place your reasoning in a dedicated reasoning section. 
Keep it short and close the section before your final answer.
If your model supports <think>...</think>, use that format.`;
}



/**
 * Utility: format capabilities into a string for the system prompt.
 * Uses [LAIToolCall] ... [/LAIToolCall] tags to wrap JSON tool calls.
 */
export function formatCapabilities(capabilities: { [key: string]: boolean }): string {
  const enabled = Object.entries(capabilities)
    .filter(([_, v]) => v)
    .map(([k]) => `- ${k}`)
    .join('\n');

  if (!enabled) return "";

  return `
You have access to the following capabilities/tools:
${enabled}

Only use a capability when explicitly requested or required.
When calling a capability, output ONLY a JSON object wrapped in [LAIToolCall] ... [/LAIToolCall].
Provide a short explanation before the JSON.

EditFile rules (summary):
- Use 0-based line numbers.
- end.line is exclusive.
- Insertions use an empty range.
- Replace entire lines, not substrings.
- Provide before/after snippets.
- Preserve indentation exactly.
`.trim();
}



export const chatPrompt = (
  language: string,
  fileContexts?: any[],
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(fileContexts);

  return `
You are a helpful AI assistant that answers developer questions clearly and concisely.
Provide only relevant code blocks, never full files unless the user explicitly asks.
The language in use is ${language}.

${Object.values(capabilities).some(v => v) ? formatCapabilities(capabilities) : ""}

Reasoning instructions:
${thinkInstructions}

${formatted ? `Here are the current file contexts:\n${formatted}` : ""}
`;
};


// ---------- Validation ----------
export const userValidationMessage = (
  code: string,
  language: string = "plaintext"
): string => `
Validate this **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const validationPrompt = (
  code: string,
  contexts?: any[],
  language: string = "plaintext",
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(contexts);

  return `
You are a code validation assistant.

${Object.values(capabilities).some(v => v) ? formatCapabilities(capabilities) : ""}

Validate the code snippet for correctness and clarity.
Determine whether it fits the surrounding file context and intended purpose.

Reasoning instructions:
${thinkInstructions}

After reasoning:
- If valid: briefly confirm validity without repeating the code.
- If context is insufficient: provide best-practice completions for ${language}.
- If issues exist:
  - Start with: "Here is the revised code (explanation to follow):"
  - Provide only the revised portion.
  - Explain changes in a numbered list.
  - Provide only the relevant code block; do not output full files unless explicitly requested.


${formatted ? `Reference contexts:\n${formatted}` : ""}

Code to validate:
\`\`\`${language}
${code.trim()}
\`\`\`
`;
};

// ---------- Completion ----------

export const userCompletionMessage = (
  code: string,
  language: string = "plaintext"
): string => `
Complete the following **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const completionPrompt = (
  code: string,
  contexts?: any[],
  language: string = "plaintext",
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(contexts);

  return `
You are a code generation assistant.

${Object.values(capabilities).some(v => v) ? formatCapabilities(capabilities) : ""}

Complete the code snippet meaningfully using the file context.
Infer the intended purpose and generate only the missing portion.
If the snippet is a comment, implement the code the comment describes.

Reasoning instructions:
${thinkInstructions}

After reasoning:
- If complete: say "The snippet appears complete and optimal as-is given the current context."
- If context is weak: provide best-practice examples for ${language}.
- If completion is needed:
  - Begin with: "Within the current file context..."
  - Provide only the missing addition.
  - Use bullet points to describe changes.
  -Provide only the relevant code block; do not output full files unless explicitly requested.


${formatted ? `Reference contexts:\n${formatted}` : ""}

Code to complete:
\`\`\`${language}
${code.trim()}
\`\`\`
`;
};

