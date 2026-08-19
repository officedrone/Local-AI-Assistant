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
 * These are files whose content has been fetched via tools and sent to the LLM.
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

/**
 * Format available file scope (list of URIs without content).
 */
export function formatFileScope(scopeUris: string[]): string | undefined {
  if (!scopeUris || scopeUris.length === 0) return undefined;

  return `Available files in workspace scope (${scopeUris.length} files):\n` +
    scopeUris.map(uri => `- ${uri}`).join('\n') + '\n\n' +
    'Use searchInFile to find relevant content, then requestFileContent to get specific lines.';
}

function buildThinkInstructions(contextSize?: number) {
  return `
When reasoning, place your reasoning in a dedicated reasoning section. 
Keep it short and close the section before your final answer.
If your model supports <think>...</think>, use that format.`;
}



/**
 * Utility: format capabilities into a string for the system prompt.
 * Uses <tool> ... </tool> XML tags to wrap JSON tool calls.
 */
export function formatCapabilities(capabilities: { [key: string]: boolean }): string {
  const enabled = Object.entries(capabilities)
    .filter(([_, v]) => v)
    .map(([k]) => `- ${k}`)
    .join('\n');

  if (!enabled) return "";

  let toolInstructions = `
You have access to the following capabilities/tools:
${enabled}

When using a capability/tool, follow this format EXACTLY:

1. First, briefly explain what you're going to do (this appears as normal assistant text)
2. Output ONLY the JSON tool call wrapped in <tool>...</tool> tags on its own line(s)
3. Wait for the tool result before continuing your response

IMPORTANT FORMATTING RULES:
- Do NOT mix explanatory text WITHIN a tool call
- Do NOT put multiple tool calls without waiting for results
- The format should be:

[Your explanation of what you're about to do]

<tool>{"type": "...", ...}</tool>

[Your continuation after receiving the tool result]

Example 1 - File search (ALWAYS do this FIRST):
I'll first search for the get_color_for_number function to find its location.

<tool>{"type": "searchInFile", "query": "def get_color_for_number", "scope": "workspace", "maxResults": 3}</tool>

After receiving search results with line numbers, I'll read the specific range:

<tool>{"type": "requestFileContent", "uri": "c:/path/to/file.py", "startLine": 132, "endLine": 180}</tool>

Example 2 - File content request (ONLY after searching):
The search showed the function is at lines 150-200, so I'll read that exact range.

<tool>{"type": "requestFileContent", "uri": "c:/path/to/config.py", "startLine": 150, "endLine": 200}</tool>
`;

  if (capabilities.editFile) {
    toolInstructions += `
EditFile rules:
- Use 0-based line numbers.
- end.line is exclusive.
- Insertions use an empty range.
- Replace entire lines, not substrings.
- Provide before/after snippets.
- Preserve indentation exactly.
`;
  }

  if (capabilities.searchInFile) {
    toolInstructions += `
searchInFile rules:
- CRITICAL: ALWAYS use search FIRST before requesting file content.
- Specify "query" as a keyword or phrase to search for.
- Specify "scope" as either "workspace" (all scope files) or "context" (fetched files).
- Optionally specify "maxResults" (default: 5) to limit results.
- Results include line numbers and matching text snippets.
- Use search to identify relevant files and exact line ranges BEFORE calling requestFileContent.
- NEVER read a full file without first searching to find what you need.

IMPORTANT - Handling Search Failures:
- If a search returns 0 matches, try SIMPLER keywords without special characters.
- Special regex characters like ^ $ * + ? . ( ) [ ] { } | \\ may prevent matches.
- Example: Instead of "^def " (with caret), use just "def" or "function".
- If still no results, search for broader terms or different parts of the code name.

Example searchInFile tool call:
<tool>{"type": "searchInFile", "query": "def processOrder", "scope": "workspace", "maxResults": 3}</tool>

After receiving search results, use the line numbers to request specific content:
<tool>{"type": "requestFileContent", "uri": "c:/path/to/file.py", "startLine": 150, "endLine": 200}</tool>
`;
  }
  
  if (capabilities.requestFileContent) {
    toolInstructions += `
requestFileContent rules:
- Use this ONLY AFTER searching to find exact line ranges you need.
- Files must be in scope before you can request their content.
- Specify "startLine" and "endLine" for the range you need (1-based).
- When smart slicing mode is active, only requested line ranges are sent to you.
- When full files mode is active, entire files are sent when any part is requested.
- Content is added to context and will be available in subsequent prompts.
- NEVER read arbitrary offsets - always use search results to determine the correct line range.

IMPORTANT - Handling File Read Errors:
- If you get "Invalid line range" error, the range may exceed file bounds or be reversed.
- ALWAYS check that startLine < endLine and both are within the file's total lines.
- Use searchInFile first to find exact locations before reading specific ranges.
- If a read fails, try searching again with broader terms or request different line numbers.

Example requestFileContent tool call (after searching):
<tool>{"type": "requestFileContent", "uri": "c:/path/to/file.py", "startLine": 150, "endLine": 200}</tool>
`;
  }

  return toolInstructions.trim();
}



export const chatPrompt = (
  language: string,
  fileContexts?: any[],
  contextSize?: number,
  capabilities: { [key: string]: boolean } = {},
  scopeUris?: string[]
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(fileContexts);
  const scopeFormatted = formatFileScope(scopeUris || []);

  return `
You are a helpful AI assistant that answers developer questions clearly and concisely.
Provide only relevant code blocks, never full files unless the user explicitly asks.
The language in use is ${language}.

${Object.values(capabilities).some(v => v) ? formatCapabilities(capabilities) : ""}

Reasoning instructions:
${thinkInstructions}

${scopeFormatted ? `${scopeFormatted}\n` : ""}${formatted ? `Here are the current file contexts:\n${formatted}` : ""}
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
  capabilities: { [key: string]: boolean } = {},
  scopeUris?: string[]
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(contexts);
  const scopeFormatted = formatFileScope(scopeUris || []);

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

${scopeFormatted ? `${scopeFormatted}\n` : ""}${formatted ? `Reference contexts:\n${formatted}` : ""}

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
  capabilities: { [key: string]: boolean } = {},
  scopeUris?: string[]
): string => {

  const thinkInstructions = buildThinkInstructions();
  const formatted = formatFileContexts(contexts);
  const scopeFormatted = formatFileScope(scopeUris || []);

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

${scopeFormatted ? `${scopeFormatted}\n` : ""}${formatted ? `Reference contexts:\n${formatted}` : ""}

Code to complete:
\`\`\`${language}
${code.trim()}
\`\`\`
 `;
};

