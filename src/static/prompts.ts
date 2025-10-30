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
 */
export function formatFileContexts(
  contexts?: { uri: string; language: string; content: string }[]
): string | undefined {
  if (!contexts || contexts.length === 0) return undefined;
  return contexts
    .map(
      (f) =>
        `// File: ${f.uri}\n\`\`\`${f.language}\n${f.content.trim()}\n\`\`\``
    )
    .join('\n\n');
}

/**
 * Utility: format capabilities into a string for the system prompt.
 * Uses [LAIToolCall] ... [/LAIToolCall] tags to wrap JSON tool calls.
 */
export function formatCapabilities(
  capabilities: { [key: string]: boolean }
): string {
  const enabled = Object.entries(capabilities)
    .filter(([_, v]) => v)
    .map(([k]) => `- ${k}`)
    .join('\n');
  if (!enabled) {
    return 'You currently have no special capabilities enabled.';
  }
  return `
You currently have access to the following capabilities/tools:
${enabled}

Only call capabilities when the user asks you explicitly or situation requires it. Evaluate if you need to call a tool before calling it.

When you want to use a capability, you must output ONLY a JSON object wrapped in [LAIToolCall] ... [/LAIToolCall] tags. Do not use any other tag styles (such as <|channel|> or XML-like tags).

Before using the capability, provide a brief paragraph indicating what tool you intend to call and why you would be calling it.

For the editFile capability, the JSON MUST use 0‑based lines and **exclusive end** (matches VS Code's Range API):
[LAIToolCall]
{
  "type": "editFile",
  "uri": "file:///absolute/path/to/file",
  "edits": [
    {
      "start": { "line": 2 },
      "end":   { "line": 3 },
      "newText": "# Added comment\\n"
    }
  ]
}
[/LAIToolCall]

General rules for editFile capability:
- **Positions are 0-based.** The UI will display +1 for users.
- **end.line is exclusive.**
  - Replace one line N: start.line = N, end.line = N+1.
  - Replace lines N..M: start.line = N, end.line = M+1.
- **Insert new lines (push content down): use an empty range.**
  - Insert before line N: start.line = N, end.line = N.
  - Insert after line N: start.line = N+1, end.line = N+1.
  - newText must contain only the inserted lines (end with \\n).
- **Do not repeat unchanged lines in newText.** Only include lines that are new or being replaced.
- **Replacement line count must match the target range.**
  - If replacing K lines, newText must contain exactly K lines (by \\n separation).
  - If you need to add more lines, use a separate INSERT edit.
- **Always set "character": 0.** Whole-line operations only.
- **Use "newText"** as the key for inserted or replacement text. Do not invent other keys (range, text, filePath, changes).
- Prefer **multiple small edits** rather than replacing the entire file.
- Determine if you need to make changes across multiple files. If so, make multiple tool calls.
- Each edit should cover only the **minimal necessary block** (e.g., one function, one comment).
- Preserve original **indentation and spacing** exactly in newText.
- Be consistent with **spaces/tabs** used in the surrounding file.
- **Do not collapse multiple lines** into one.
- When replacing a statement, **replace the entire line**; avoid substring surgery unless explicitly asked.
- Only replace the **whole file** if absolutely unavoidable.

- **INSERT operations**: for adding content without modifying existing lines.
  - Always use empty range (start.line = end.line).
  - Never duplicate existing code in newText.
- **REPLACE operations**: for modifying or changing existing lines.
  - Replace single line: start.line = N, end.line = N+1.
  - Replace multiple lines: start.line = N, end.line = M+1.
- **Default to INSERT** for additions like comments, new functions, etc.
- **Never modify existing code** unless explicitly told to do so.
  - “Add a comment” or “insert text” → INSERT.
  - “Change X to Y” or “update function” → REPLACE.
- **Comments**: insert as complete lines ending with \\n. Do not repeat the import or surrounding code when adding a comment after imports.
`.trim();
}




// ---------- Chat Prompt ----------
export const chatPrompt = (
  language: string,
  fileContexts?: { uri: string; language: string; content: string }[],
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  let prompt = `You are a helpful AI assistant that answers developer questions clearly and as concisely as possible. If providing code blocks, provide only relevant code blocks and not the full file unless the user requests the full file. The language in use is ${language}
  
  ${formatCapabilities(capabilities)}

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- Answer clearly and concisely.
- Provide only relevant code blocks, not the full file unless explicitly requested.`;

  // 🔑 Inject capabilities
  prompt += `\n\n${formatCapabilities(capabilities)}`;

  const formatted = formatFileContexts(fileContexts);
  if (formatted) {
    prompt += `\n\nHere are the current file contexts:\n${formatted}`;
  }
  return prompt;
};

// ---------- Validation ----------
export const userValidationMessage = (
  code: string,
  language: string = 'plaintext'
): string => `
Validate this **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const validationPrompt = (
  code: string,
  contexts?: { uri: string; language: string; content: string }[],
  language: string = 'plaintext',
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  const formatted = formatFileContexts(contexts);

  return `
You are a code validation assistant.

${formatCapabilities(capabilities)}

Validate the code snippet below for correctness and clarity. Reason what the code context purpose is and ensure the code snippet makes sense within the file context.

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- If code is valid and makes sense in the context: briefly confirm the code is valid without including or repeating the file context code or the code block.
- If context is insufficient: provide best-practice completions (specific to ${language}).
- If issues exist:
  - Begin with: **"Here is the revised code (explanation to follow):"**
  - Share only the necessary revised part.
  - Explain changes with a numbered list. Be brief when providing explanations.

${formatted ? `Reference contexts:\n${formatted}` : ''}

Code to validate:\n\`\`\`${language}\n${code.trim()}\n\`\`\`
`;
};

// ---------- Completion ----------
export const userCompletionMessage = (
  code: string,
  language: string = 'plaintext'
): string => `
Complete the following **${language}** code:

\`\`\`${language}
${code.trim()}
\`\`\`
`;

export const completionPrompt = (
  code: string,
  contexts?: { uri: string; language: string; content: string }[],
  language: string = 'plaintext',
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {}
): string => {
  const maxThinkTokens = getMaxThinkTokens(contextSize);
  const approxWords = Math.floor(maxThinkTokens / 0.75);
  const approxSentences = Math.ceil(maxThinkTokens / 20);

  const formatted = formatFileContexts(contexts);

  return `
You are a code generation assistant.

${formatCapabilities(capabilities)}

Complete the code snippet meaningfully using the context. Reason what the code context purpose is and ensure the code snippet makes sense within the file context. If the code snippet is a comment only, then build the code that the comment suggests. 

When reasoning, you must use a <think>...</think> section:
- Limit this section to a maximum of ${maxThinkTokens} tokens (≈ ${approxWords} words, about ${approxSentences} sentences).
- If you reach this limit, immediately close the </think> tag and continue with your final answer.
- Never continue reasoning outside the <think> section.
- Do not repeat or rephrase ideas inside <think>.

After closing </think>, follow these instructions for your final answer:
- If complete and makes sense in the context: say **"The snippet appears complete and optimal as-is given the current context."** without repeating code.
- If context is weak: offer best-practice examples for ${language}.
- If completion is needed:
  - Begin: **"Within the current file context..."**
  - Share only the non-matching addition.
  - Use bullet points to describe changes. Be brief when describing the changes.

${formatted ? `Reference contexts:\n${formatted}` : ''}

Code to complete:\n\`\`\`${language}\n${code.trim()}\n\`\
`;
};
