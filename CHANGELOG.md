# Change Log

## 0.0.20 – Modularization, initial support for reasoning models

- ADD: error handling in bubbles in case user sends message to a dead endpoint
- ADD: keywords to package.json for marketplace visibility

## 0.0.19 – Modularization, initial support for reasoning models

- UPDATE: usability/Styling enhancements
- UPDATE: additional Health Service banner changes

## 0.0.18 – Modularization, initial support for reasoning models

- UPDATE: svc healthcheck logic to avoid spam banners if LLM service is down; protection against disposed webviews
- UPDATE: ehnancements to thinking bubbles/logic. Should now cover most reasoning scenarios
- ADD: introduce support for ByteDance Seed thinking logic
- UPDATE - light styling changes to chat bubbles. Style revamp planned for upcoming version.

## 0.0.17 – Modularization, initial support for reasoning models

- FIX - Re-include dependencies (good ol case of 'worked on my machine')

## 0.0.16 – Modularization, initial support for reasoning models

- FIX - Fix files inclusion in package.json to correctly bundle new file structure in extension

## 0.0.15 – Modularization, initial support for reasoning models

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
