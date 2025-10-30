# Change Log

## 0.0.26 – More Multi-file context implementation

- ADD: Agent framework + editFile tool (EXPERIMENTAL! Very early implementation so use at own risk) - Allow LLM to edit files in the workspace.
- ADD: Capabilities framework, UI section
- FIX: New session will always load 'fresh' files in the context. Also updated how/what files are loaded on new session based on previous context and what file is active when the new session was started.

## 0.0.25 – More Multi-file context implementation

- ADD: Support for [THINK] [/THINK] reasoning
- UPDATE: Session tokens section (Title, Think addition)
- UPDATE: If model response takes longer than 10 secs, indicate it may be due to context processing.
- UPDATE: Rework of styles.css to reduce spaghetti and overall size by 30/40%

## 0.0.24 – More Multi-file context implementation

- FIX: Fix auto-added file context tokens not being counted on first turn
- UPDATE: More sytling updates

## 0.0.23 – Multi-file context implementation

- ADD: Added the ability to add multiple files to context
- UPDATE: Styling updates

## 0.0.22 – Fix Complete/Validate code commands extension-side messaging and stop logic

- FIX: New session now sends signal to back end to stop generation - now works for Complete/Generate code commands as well
- UPDATE: Streamline messaging routing path for Code Validate and Code Complete commands

## 0.0.21 – Further stream cancellation enhamcements, stop health while responses streaming

- FIX: New session now sends signal to back end to stop generation
- FIX: LLM bubble pulsating now stops pulsating on time-out
- UPDATE: Stop svc health check while stream is active (streaming state implies service is up). Resume once streaming ends, or if timeout is encountered.

## 0.0.20 – Dead response handling update, added more robust stream cancellation logic

- ADD: error handling in bubbles in case user sends message to a dead endpoint
- ADD: keywords to package.json for marketplace visibility
- FIX: user pressing 'stop' stopping the stream in the UI not always stopping LLM stream from the server in certain cases
- FIX: some thinking/reasoning bubbles styles not being removed
- UPDATE: took a first stab at smoothing out scrolling in fast LLM response cases

## 0.0.19 – Style updates / svc banner update

- UPDATE: usability/Styling enhancements
- UPDATE: additional Health Service banner changes

## 0.0.18 – Service healtcheck update / thinking bubbles enhamcements / Deepseek support / Style update

- UPDATE: svc healthcheck logic to avoid spam banners if LLM service is down; protection against disposed webviews
- UPDATE: ehnancements to thinking bubbles/logic. Should now cover most reasoning scenarios
- ADD: introduce support for ByteDance Deepseek Seed thinking logic
- UPDATE - light styling changes to chat bubbles. Style revamp planned for upcoming version.

## 0.0.17 – Fix 2 for includes in package.json

- FIX - Re-include dependencies (fix good ol case of 'worked on my machine' resulting in broken extension on other machines)

## 0.0.16 – Fix for includes in package.json

- FIX - Fix files inclusion in package.json to correctly bundle new file structure in extension

## 0.0.15 Modularization, initial support for reasoning models

- UPDATE: massive redesign of chatPanel / chatPanelView components. Broke them up into sub-modules to facilitate ease of feature enablement in future.
- ADD: initial support for reasoning models. Limited reasoning to 1/5 of configured context tokens (will implement separate variables for this in upcoming version)
- UPDATE: Update internal folder structure to keep it in line with future modularization efforts.
- UPDATE: Styling and usability fixes

## 0.0.14 – API Type + Context Size UI elements

- ADD: visual service healtcheck and relevant handlers
- ADD: 'spent' tokens as session count (flipping between files no longer changes Total tokens used in session)
- FIX: force-scroll reduction, some styling cleanup

## 0.0.13 – API Type + Context Size UI elements

- UPDATE: contextSize vars to contextSize
- UPDATE: User bubble token count excludes current file token count (that one is added separately to the total)
- FIX: File Context Tokens not being counted correctly when file excluded from context.

## 0.0.12 – API Type + Context Size UI elements

- ADD: ability to set API type and Context Size from UI
- UPDATE: Styling of token counter
- UPDATE: Some prompts to promote brevity of answers.

## 0.0.11 – URL & Model selection UI elements

- ADD: URL and Model selection commands, UI elements, styling, initial error handling
- FIX: Removed unintended scroll to button on pressing copy or insert buttons within chat
- UPDATE: Styling, code readability enhancements

## 0.0.10 – OpenAI/Ollama proxy fixes

- FIX: Ollama/OpenAI-compatible endpoints not respecting config URL setting
- FIX: OpenAI-compatible endpoint model selector logic

## 0.0.9 – File context fixes, introduced contextHandler.ts

- FIX: File context not being included in certain cases
- ADD: Abstract context handling locic to contextHandler.ts
- UPDATE: Prompts update

## 0.0.8 – Major routing rewrite, styling update, bugfixes

- ADD: New 'route-to-LLM' logic including a dedicated routing handler, streaming handler, etc.
- ADD: Stream-related and token counting logic updates to leverage new routing
- FIX: fix auto-scroll breaking again in certain instances
- UPDATE: Ollama prompts, model insertion logic, URL logic
- UPDATE: Styling
- Other small enhancements

## 0.0.7 – Retain code indentation, bugfixes

- FIX: retain correct indentation when inserting code blocks
- FIX: fix auto-scroll breaking in certain instances
- FIX: bug where file context checkbox was referencing stale config setting URI

## 0.0.6 – Bugfix, Settings re-org, setup instructions

- FIX: content not being passed correctly when chatting from input box
- ADD: dynamic handling for /v1 and /api trails in the apiURL field.
- ADD: settings categories
- readme update - setup section

## 0.0.5 – Token counter, contextSize config option

- ADD: contextSize config option to specify contex size
- ADD: token counters at the top of the chat section and chat bubbles
- styling improvements
- ADD: extension tags

## 0.0.4 – Context menu and language auto-detect

- ADD: leverage VS Code language auto-detect and embed detected language in prompts
- ADD: right-click menu in editor for complete code, validate code, open chat window
- prompt enhancements

## 0.0.3 – Tooltip Tweaks

- tweak tooltip agressiveness;
- ADD: tooltip disable button to tooltip;
- update readme;
- update chatpanel size

## 0.0.2 – Prep for publishing to marketplace

- formatting updates for publishing in marketplace

## 0.0.1 – Initial Release

- Chat panel with markdown rendering and code streaming
- Code validation command
- Code completion command
- Idle-based tooltip with hover interaction
- Configurable API endpoint
- New secure API key setup command
- Model selection interface
- Extension settings panel command

---
