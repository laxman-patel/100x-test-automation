# Extension Console Error Fix Playbook (Agent-Prompt Oriented)

Generated: 2026-02-26T20:05:35.323033+00:00

## What this file is
- Full-build analysis of console failures (`console.error`, `console.warn`, `throw new Error`) in the extension bundles.
- Designed so an LLM can map runtime logs to likely root cause and immediately craft a targeted fix prompt.

## Coverage Stats
- JS files scanned: `96`
- Error/warn/throw signatures extracted: `781`
- Components detected: `142`

## How to use with an agent
1. Match the console line prefix (e.g. `[WorkflowContext]`, `[Offscreen]`).
2. Find matching signature stem in the Component Matrix.
3. Use the kind ID(s) to pick the exact prompt from the Kind Prompt Library.
4. Provide the agent: failing logs + source path + selected prompt template.

## Kind Prompt Library
| Kind ID | Meaning | Typical Fix Direction | Prompt To Give Agent |
|---|---|---|---|
| `OFFSCREEN_MEDIA` | Offscreen worker or media pipeline failure (FFmpeg/MuPDF/7z/ImageMagick/Canvas/Mermaid/WASM). | Validate binary assets, input payloads (base64/binary), command args, and worker message contract; add guardrails + retries. | `Analyze Offscreen/media errors in console. Trace request payload -> offscreen message -> worker execution -> output file read. Fix root cause, add input validation, and return a patch + verification steps.` |
| `IPC_BRIDGE` | Port/bridge messaging mismatch, timeout, or unknown message type. | Align request/response schema, message `type`, correlation IDs, timeout handling, and reconnect logic. | `Debug extension IPC bridge failure. Match sender/receiver message schema and type strings, fix unknown type/timeouts, and add robust response correlation + reconnection.` |
| `AUTH_PERMISSION` | Authentication, token, or browser permission issue. | Check auth context/session lifecycle, token fetch path, and permissions fallback UX (request/retry/degrade). | `Investigate auth/permission console errors. Identify failing token/permission path, implement proper checks and fallback flow, then patch and list manual repro steps.` |
| `SCHEDULER` | Alarm/schedule workflow execution path failed. | Validate schedule IDs/workflow IDs, restoration on startup, and stale schedule cleanup logic. | `Fix scheduler/alarm workflow failures. Verify schedule CRUD invariants, startup restore, and stale schedule cleanup. Provide code changes and tests for schedule success/failure paths.` |
| `WORKFLOW_NOT_FOUND` | Workflow lookup failed by name/id/path. | Normalize workflow IDs/names, validate `workflow://` references, and add pre-execution existence checks. | `Resolve workflow-not-found errors. Track lookup path from UI/input to storage query, normalize identifiers, and add friendly validation before execution.` |
| `NOT_FOUND` | General missing resource (file/tool/session/record). | Add existence checks, clear diagnostics, and fallback behavior where safe. | `Find and fix not-found failures from console logs. Add precondition checks and actionable error messages, then patch call sites that pass invalid IDs/keys.` |
| `MISSING_INPUT` | Required parameter absent or null. | Strengthen input validation at boundary, defaulting where safe, and fail-fast with clear error text. | `Fix missing-input failures. Add schema/argument validation at API boundaries, provide safe defaults where possible, and update callers to pass required fields.` |
| `INVALID_INPUT` | Invalid format/value/type supplied. | Normalize input format, enforce schema constraints, and add conversion/sanitization. | `Debug invalid-input errors. Identify invalid parameter shape/value, enforce schema normalization, and patch upstream generators/callers to produce valid inputs.` |
| `VALIDATION_PARSE` | Schema validation or JSON/AST parsing failed. | Repair parser assumptions, harden structured output parsing, and include recovery/fallback strategy. | `Fix validation/parse failures seen in logs. Reproduce with failing payload, patch parser/validator logic, and add fallback handling with precise error reporting.` |
| `NETWORK_API` | Remote call failed (HTTP/API/streaming). | Add retry/backoff, status-aware handling, auth propagation, and response-shape checks. | `Investigate network/API errors from console. Patch request auth headers, status handling, retries, and response parsing; include telemetry improvements.` |
| `STORAGE_DB` | Persistence/indexing/storage initialization/read/write failure. | Handle migrations/open failures, null stores, and serialization issues; add recovery path. | `Fix storage/database errors. Trace failing storage operation, add migration/open safeguards, repair serialization/index updates, and verify persistence roundtrip.` |
| `TAB_DOM` | Tab/content-script/DOM operation failed (inject, navigation, selector, iframe/shadow). | Harden tab state checks, reinjection strategy, selector context handling, and cross-frame guards. | `Debug tab/DOM automation errors. Fix content-script injection, tab readiness checks, and selector/frame handling; add retries and better diagnostics.` |
| `CAPABILITY_REGISTRY` | Capability/tool registry missing or lookup failure. | Ensure capability registration order, lazy init completion, and registry lookup normalization. | `Fix capability registry errors. Verify registration lifecycle, namespace/tool IDs, and initialization ordering so lookups always resolve.` |
| `CAPABILITY_EXEC` | Capability execution threw/returned failure. | Patch capability-specific preconditions and output contracts; improve error propagation. | `Investigate capability execution failures. Reproduce failing capability call, fix contract/precondition mismatch, and improve error result structure.` |
| `TIMEOUT_CANCEL` | Operation timed out or was aborted/cancelled. | Tune timeouts, add cancellation-safe cleanup, and ensure long-running tasks emit progress/heartbeats. | `Fix timeout/cancellation issues. Identify long-running stage, optimize or split work, adjust timeout policy, and implement cancellation-safe cleanup.` |
| `UI_RUNTIME` | UI/runtime mounting/provider/render errors. | Ensure provider hierarchy and mount roots exist; guard runtime code execution and recover gracefully. | `Fix UI runtime errors from console. Validate provider composition and mount roots, patch render-time exceptions, and add defensive guards with fallback UI.` |
| `FILE_IO` | File read/write/encoding/transfer failure. | Validate file existence/data encoding/size, and harden upload-download conversion paths. | `Debug file I/O failures in extension. Verify key existence, base64/binary conversions, and read/write paths; add strict validation and clearer errors.` |
| `GENERAL_RUNTIME` | General runtime failure not covered above. | Use nearby logs/stack to isolate failing module and add specific guard + tests. | `Analyze unresolved runtime errors from provided logs. Locate failing module, patch root cause, and add targeted regression checks.` |

## Component Matrix (All Detected Error Components)
| # | Component Prefix | Signatures | Top Kind IDs | Representative Error Stems | Primary Source |
|---:|---|---:|---|---|---|
| 1 | `Offscreen` | 112 | `OFFSCREEN_MEDIA` | [error] [Offscreen]; [error] [Offscreen] 7z create error:; [error] [Offscreen] 7z extract error: | `assets/offscreen-3di9z-KA.js` |
| 2 | `ServiceWorker` | 26 | `GENERAL_RUNTIME`,`TAB_DOM`,`STORAGE_DB` | [error] [ServiceWorker] <var> message error:; [error] [ServiceWorker] Capability execution error:; [error] [ServiceWorker] Capability list error: | `assets/index.ts-NvJjNdT1.js` |
| 3 | `UserInteractionRecording` | 25 | `GENERAL_RUNTIME`,`TAB_DOM`,`OFFSCREEN_MEDIA` | [error] [UserInteractionRecording] Auto-save failed:; [error] [UserInteractionRecording] Error stopping speech recording:; [error] [UserInteractionRecording] Failed to start offscreen speech recording: | `assets/index.ts-NvJjNdT1.js` |
| 4 | `AgentHandler` | 18 | `GENERAL_RUNTIME`,`VALIDATION_PARSE`,`NOT_FOUND` | [throw] [AgentHandler] ExecutionContext or metadata is null; [error] [AgentHandler] Failed to delete cell:; [error] [AgentHandler] Failed to delete conversation: | `assets/index.ts-NvJjNdT1.js` |
| 5 | `AgentTools` | 17 | `GENERAL_RUNTIME`,`AUTH_PERMISSION`,`STORAGE_DB` | [error] [AgentTools] Error cleaning up live query:; [error] [AgentTools] Failed to clear message history:; [error] [AgentTools] Failed to clear permissions: | `assets/index.ts-NvJjNdT1.js` |
| 6 | `BaseDomCapability` | 16 | `TAB_DOM`,`INVALID_INPUT`,`MISSING_INPUT` | [error] [BaseDomCapability] Content script reinjection failed, cannot retry; [error] [BaseDomCapability] Error checking tab status:; [error] [BaseDomCapability] Failed to generate shadow debug info: | `assets/index.ts-NvJjNdT1.js` |
| 7 | `ConfigurationStorage` | 15 | `STORAGE_DB`,`IPC_BRIDGE` | [error] [ConfigurationStorage] Constructor failed:; [error] [ConfigurationStorage] Failed to delete configuration:; [error] [ConfigurationStorage] Failed to export configurations: | `assets/index.ts-NvJjNdT1.js` |
| 8 | `PermissionContext` | 14 | `AUTH_PERMISSION`,`IPC_BRIDGE` | [error] [PermissionContext] Error clearing permissions:; [error] [PermissionContext] Error deleting permission:; [error] [PermissionContext] Error loading permissions: | `assets/index.html-Dt7qjZUV.js` |
| 9 | `BinaryChunkedPort` | 13 | `GENERAL_RUNTIME`,`INVALID_INPUT`,`IPC_BRIDGE` | [error] [BinaryChunkedPort] ERROR: Chunk <var> has empty serialized array!; [error] [BinaryChunkedPort] ERROR: Chunk <var> has invalid byte values:; [error] [BinaryChunkedPort] ERROR: Chunk <var> has unsupported data type: | `assets/BinaryChunkedPort-CmLfzyL4.js` |
| 10 | `ConversationSession` | 12 | `NOT_FOUND`,`GENERAL_RUNTIME`,`STORAGE_DB` | [error] [ConversationSession] Failed to load from storage:; [error] [ConversationSession] Failed to save (debounced):; [error] [ConversationSession] Failed to save to storage: | `assets/index.ts-NvJjNdT1.js` |
| 11 | `WorkflowContext` | 12 | `GENERAL_RUNTIME`,`NETWORK_API`,`WORKFLOW_NOT_FOUND` | [error] [WorkflowContext] Error creating workflow:; [error] [WorkflowContext] Error deleting workflow:; [error] [WorkflowContext] Error executing workflow: | `assets/index.html-Dt7qjZUV.js` |
| 12 | `AgentUI` | 11 | `GENERAL_RUNTIME`,`INVALID_INPUT`,`NETWORK_API` | [error] [AgentUI] Both session loads failed:; [error] [AgentUI] Error inserting file reference:; [error] [AgentUI] Failed to execute direct tool call: | `assets/index.html-Dt7qjZUV.js` |
| 13 | `IndexeddbFileStorage` | 11 | `STORAGE_DB` | [error] [IndexeddbFileStorage] Circuit breaker opened; [error] [IndexeddbFileStorage] Database corruption detected:; [error] [IndexeddbFileStorage] Database error: | `assets/UserValueTracker-DwHPs7UU.js` |
| 14 | `InteractionRecorder` | 11 | `GENERAL_RUNTIME`,`IPC_BRIDGE` | [error] [InteractionRecorder] Error stopping speech recognition:; [error] [InteractionRecorder] Failed to establish streaming connection:; [error] [InteractionRecorder] Failed to restart speech recognition: | `src/pages/content/index.tsx.js` |
| 15 | `FFmpegCapability` | 9 | `OFFSCREEN_MEDIA` | [error] [FFmpegCapability] Error loading font <var>:; [error] [FFmpegCapability] Failed to convert blob to ArrayBuffer for <var>:; [error] [FFmpegCapability] Failed to fetch font: <var> (<var> <var>) | `assets/index.ts-NvJjNdT1.js` |
| 16 | `UIRequestHandler` | 9 | `VALIDATION_PARSE`,`GENERAL_RUNTIME`,`MISSING_INPUT` | [error] [UIRequestHandler] Error fetching workflows:; [warn] [UIRequestHandler] Failed to parse tool_call_complete content for cell:; [warn] [UIRequestHandler] Failed to parse tool_call_complete content: | `assets/index.html-Dt7qjZUV.js` |
| 17 | `WorkflowStorage` | 9 | `STORAGE_DB`,`VALIDATION_PARSE` | [error] [WorkflowStorage] Constructor failed:; [error] [WorkflowStorage] Failed to delete workflow:; [error] [WorkflowStorage] Failed to get workflow: | `assets/index.ts-NvJjNdT1.js` |
| 18 | `WangUI` | 8 | `GENERAL_RUNTIME`,`NETWORK_API`,`NOT_FOUND` | [throw] [WangUI] Circular dependency detected: <var>; [error] [WangUI]; [error] [WangUI] Failed to execute module <var>: | `assets/ai-ui-BhwdKz5d.js` |
| 19 | `AgentUIInner` | 7 | `GENERAL_RUNTIME`,`TAB_DOM` | [error] [AgentUIInner] Error enabling floating UI:; [error] [AgentUIInner] Failed to close sidepanel:; [error] [AgentUIInner] Failed to delete: | `assets/index.html-Dt7qjZUV.js` |
| 20 | `AsyncTaskManager` | 7 | `NOT_FOUND`,`STORAGE_DB`,`GENERAL_RUNTIME` | [error] [AsyncTaskManager] Cannot attach promise - task <var> not found; [error] [AsyncTaskManager] Error updating storage for failed task <var>:; [error] [AsyncTaskManager] Error updating storage for task <var>: | `assets/index.ts-NvJjNdT1.js` |
| 21 | `BinaryOffscreenPortManager` | 7 | `OFFSCREEN_MEDIA` | [error] [BinaryOffscreenPortManager] Binary file upload failed for <var>:; [error] [BinaryOffscreenPortManager] Failed to connect to offscreen document:; [error] [BinaryOffscreenPortManager] Failed to convert base64 to ArrayBuffer: | `assets/index.ts-NvJjNdT1.js` |
| 22 | `DashboardUICapability` | 7 | `CAPABILITY_EXEC`,`GENERAL_RUNTIME`,`VALIDATION_PARSE` | [error] [DashboardUICapability] Error:; [warn] [DashboardUICapability] AST parse failed:; [warn] [DashboardUICapability] Clear failed: | `assets/index.ts-NvJjNdT1.js` |
| 23 | `ManagedTab` | 7 | `TAB_DOM`,`AUTH_PERMISSION` | [error] >[ManagedTab] Error checking tab state:; [error] [ManagedTab] Error checking tab state:; [error] [ManagedTab] Failed to get state for tab <var>: | `assets/index.ts-NvJjNdT1.js` |
| 24 | `SelectorResolver` | 7 | `TAB_DOM` | [error] [SelectorResolver] Context chain traversal failed:; [error] [SelectorResolver] Error resolving selector in context:; [error] [SelectorResolver] Error resolving selector: | `src/pages/content/index.tsx.js` |
| 25 | `useCellHandlers` | 7 | `GENERAL_RUNTIME`,`STORAGE_DB` | [error] [useCellHandlers] Cell execution failed:; [error] [useCellHandlers] Cell update failed:; [error] [useCellHandlers] Failed to delete cell from storage: | `assets/index.html-Dt7qjZUV.js` |
| 26 | `WANG Content` | 7 | `GENERAL_RUNTIME`,`CAPABILITY_EXEC`,`CAPABILITY_REGISTRY` | [error] [WANG Content] Capability <var> error:; [error] [WANG Content] Capability <var> failed:; [error] [WANG Content] Execution error: | `src/pages/content/index.tsx.js` |
| 27 | `ContentScriptManager` | 6 | `TAB_DOM`,`GENERAL_RUNTIME` | [error] [ContentScriptManager] All injection attempts failed for tab <var>; [error] [ContentScriptManager] Attempt <var> failed for tab <var>:; [error] [ContentScriptManager] Error reading manifest: | `assets/index.ts-NvJjNdT1.js` |
| 28 | `useMessageHistory` | 6 | `STORAGE_DB`,`GENERAL_RUNTIME` | [error] [useMessageHistory] Failed to clear FileStorage:; [error] [useMessageHistory] Failed to save to FileStorage:; [error] [useMessageHistory] Failed to save to sync: | `assets/index.html-Dt7qjZUV.js` |
| 29 | `WorkflowPreview` | 6 | `UI_RUNTIME`,`VALIDATION_PARSE` | [error] [WorkflowPreview] Error checking execution safety:; [error] [WorkflowPreview] Error during security checks:; [error] [WorkflowPreview] Error fetching tabs: | `assets/index.html-Dt7qjZUV.js` |
| 30 | `AlarmManager` | 5 | `SCHEDULER` | [error] [AlarmManager] Scheduled workflow execution failed for schedule "<var>":; [warn] [AlarmManager] Failed to restore alarms (may not be logged in yet):; [warn] [AlarmManager] Failed to update schedule document after error: | `assets/index.ts-NvJjNdT1.js` |
| 31 | `CapabilityManager` | 5 | `CAPABILITY_EXEC`,`NETWORK_API` | [error] [CapabilityManager] Capability execution failed:; [error] [CapabilityManager] Failed to execute capability:; [error] [CapabilityManager] Failed to fetch capabilities: | `assets/index.html-Dt7qjZUV.js` |
| 32 | `ContextManager` | 5 | `GENERAL_RUNTIME`,`TAB_DOM` | [error] [ContextManager] Failed to get browser context:; [error] [ContextManager] Failed to get current URL:; [error] [ContextManager] Failed to get workflows by domain: | `assets/index.ts-NvJjNdT1.js` |
| 33 | `ConversationManager` | 5 | `STORAGE_DB`,`GENERAL_RUNTIME` | [error] [ConversationManager] Failed to delete session <var> from storage:; [error] [ConversationManager] Failed to get all conversations:; [error] [ConversationManager] Failed to initialize storage: | `assets/index.ts-NvJjNdT1.js` |
| 34 | `MessageRouter` | 5 | `IPC_BRIDGE` | [error] [MessageRouter] Error handling SystemManager command:; [error] [MessageRouter] Error handling tool command:; [error] [MessageRouter] Failed to parse bridge-control-message: | `assets/index.ts-NvJjNdT1.js` |
| 35 | `PermissionManager` | 5 | `AUTH_PERMISSION` | [error] [PermissionManager] Error sending permission request:; [error] [PermissionManager] Failed to save permission rule:; [error] [PermissionManager] Failed to send permission request to UI: | `assets/utils-BJ644OfL.js` |
| 36 | `WebSocketBridge` | 5 | `IPC_BRIDGE` | [error] [WebSocketBridge] Cannot send message, not connected; [error] [WebSocketBridge] Error in <var> handler:; [error] [WebSocketBridge] Error parsing message: | `assets/index.ts-NvJjNdT1.js` |
| 37 | `CapabilityContext` | 4 | `CAPABILITY_EXEC`,`NETWORK_API` | [error] [CapabilityContext] Error executing capability:; [error] [CapabilityContext] Failed to fetch capabilities:; [error] [CapabilityContext] Failed to get capability info: | `assets/index.html-Dt7qjZUV.js` |
| 38 | `GrepEngine` | 4 | `GENERAL_RUNTIME` | [warn] [GrepEngine] Content is null or undefined, returning empty result; [warn] [GrepEngine] Hit match limit per line:; [warn] [GrepEngine] Potentially slow regex pattern detected: | `assets/index.ts-NvJjNdT1.js` |
| 39 | `IndexedDBConversationStorage` | 4 | `STORAGE_DB` | [error] [IndexedDBConversationStorage] Failed to add to search index:; [error] [IndexedDBConversationStorage] Failed to update search index:; [error] [IndexedDBConversationStorage] Search index initialization failed: | `assets/index.ts-NvJjNdT1.js` |
| 40 | `SelectorOverlay` | 4 | `TAB_DOM` | [error] [SelectorOverlay] Error during context discovery:; [error] [SelectorOverlay] Error highlighting element:; [warn] [SelectorOverlay] Context discovery failed: | `src/pages/content/index.tsx.js` |
| 41 | `SessionTracker` | 4 | `STORAGE_DB`,`GENERAL_RUNTIME` | [error] [SessionTracker] Failed to clear storage:; [error] [SessionTracker] Failed to load from storage:; [error] [SessionTracker] Failed to save to storage: | `assets/index.ts-NvJjNdT1.js` |
| 42 | `SystemManager` | 4 | `GENERAL_RUNTIME` | [error] [SystemManager] Command processing error:; [error] [SystemManager] Failed to initialize:; [error] [SystemManager] Shutdown handler error: | `assets/index.ts-NvJjNdT1.js` |
| 43 | `useFileUpload` | 4 | `FILE_IO`,`STORAGE_DB` | [error] [useFileUpload] Failed to store file:; [error] [useFileUpload] File storage failed:; [error] [useFileUpload] File upload error: <var> | `assets/index.html-Dt7qjZUV.js` |
| 44 | `WangWorkflowExecutor` | 4 | `GENERAL_RUNTIME`,`TAB_DOM` | [error] [WangWorkflowExecutor] Wang execution error captured:; [error] [WangWorkflowExecutor] Workflow execution failed:; [warn] [WangWorkflowExecutor] Failed to emit workflow update: | `assets/index.ts-NvJjNdT1.js` |
| 45 | `WorkflowHandler` | 4 | `GENERAL_RUNTIME`,`VALIDATION_PARSE` | [error] [WorkflowHandler] Failed to delete workflow <var>:; [error] [WorkflowHandler] Failed to initialize:; [error] [WorkflowHandler] Input validation failed: | `assets/index.ts-NvJjNdT1.js` |
| 46 | `AgentOrchestratorCapability` | 3 | `CAPABILITY_EXEC`,`GENERAL_RUNTIME` | [warn] [AgentOrchestratorCapability] Auto-compaction failed:; [warn] [AgentOrchestratorCapability] Could not get selected model for session:; [warn] [AgentOrchestratorCapability] Failed to track session start: | `assets/index.ts-NvJjNdT1.js` |
| 47 | `ChunkedPort` | 3 | `GENERAL_RUNTIME`,`IPC_BRIDGE` | [error] [ChunkedPort] Error in message handler:; [error] [ChunkedPort] Failed to send message:; [warn] [ChunkedPort] Attempted to send message on disconnected port: | `assets/ChunkedPort-BOxHelyM.js` |
| 48 | `ConfigurationService` | 3 | `GENERAL_RUNTIME`,`NOT_FOUND` | [error] [ConfigurationService] Failed to load built-in configs:; [error] [ConfigurationService] Failed to load config <var>:; [error] [ConfigurationService] Failed to register config <var> - not found after registration | `assets/index.ts-NvJjNdT1.js` |
| 49 | `ConversationContext` | 3 | `GENERAL_RUNTIME` | [error] [ConversationContext] Error deleting conversation:; [error] [ConversationContext] Error fetching conversations:; [error] [ConversationContext] Error loading conversation: | `assets/index.html-Dt7qjZUV.js` |
| 50 | `ConversationHistoryManager` | 3 | `GENERAL_RUNTIME` | [warn] [ConversationHistoryManager] Builder mode: Unexpected screenshot data format:; [warn] [ConversationHistoryManager] Failed to capture screenshot for builder mode:; [warn] [ConversationHistoryManager] Failed to delete ephemeral screenshot <var>: | `assets/index.ts-NvJjNdT1.js` |
| 51 | `FileStorageCapability` | 3 | `STORAGE_DB`,`AUTH_PERMISSION` | [error] [FileStorageCapability] Failed to sync permission to server:; [error] [FileStorageCapability] Large file download failed:; [warn] [FileStorageCapability] Failed to decode base64 for text file <var>: | `assets/index.ts-NvJjNdT1.js` |
| 52 | `ImageMagickCapability` | 3 | `OFFSCREEN_MEDIA` | [error] [ImageMagickCapability] Error calling <var>:; [error] [ImageMagickCapability] Failed to initialize ImageMagick WASM:; [error] [ImageMagickCapability] Processing error: | `assets/index.ts-NvJjNdT1.js` |
| 53 | `Inspector` | 3 | `TAB_DOM` | [error] [Inspector] Error discovering contexts:; [warn] [Inspector] Context discovery failed, falling back to legacy detection:; [warn] [Inspector] No active tab found for context discovery | `src/pages/content/index.tsx.js` |
| 54 | `MemoryStorage` | 3 | `STORAGE_DB` | [error] [MemoryStorage] List failed:; [error] [MemoryStorage] Maintenance failed:; [error] [MemoryStorage] Search failed: | `assets/index.ts-NvJjNdT1.js` |
| 55 | `MessageHandler` | 3 | `GENERAL_RUNTIME` | [error] [MessageHandler] Agent response error:; [error] [MessageHandler] Error executing tool_call:; [error] [MessageHandler] Failed to execute tool_call: | `assets/index.html-Dt7qjZUV.js` |
| 56 | `ModelSelector` | 3 | `TAB_DOM` | [error] [ModelSelector] Failed to load models:; [error] [ModelSelector] Failed to load selected model:; [error] [ModelSelector] Failed to save model selection: | `assets/index.html-Dt7qjZUV.js` |
| 57 | `OffscreenPortManager` | 3 | `OFFSCREEN_MEDIA` | [error] [OffscreenPortManager] Chunk transfer error:; [error] [OffscreenPortManager] Failed to connect to offscreen document:; [warn] [OffscreenPortManager] Received response for unknown request: | `assets/index.ts-NvJjNdT1.js` |
| 58 | `ScreenshotCapability` | 3 | `CAPABILITY_EXEC`,`GENERAL_RUNTIME` | [error] [ScreenshotCapability] Capture failed:; [error] [ScreenshotCapability] Unexpected error:; [warn] [ScreenshotCapability] Could not determine image dimensions: | `assets/index.ts-NvJjNdT1.js` |
| 59 | `SessionContext` | 3 | `STORAGE_DB`,`GENERAL_RUNTIME` | [error] [SessionContext] Failed to load session from storage:; [error] [SessionContext] Failed to save session to storage:; [warn] [SessionContext] Failed to register session: | `assets/ThemeContext-CsfA26O2.js` |
| 60 | `SpeakOperationHandler` | 3 | `GENERAL_RUNTIME`,`NOT_FOUND` | [error] [SpeakOperationHandler] No agentTools available in context for speak operations; [error] [SpeakOperationHandler] Speak operation failed:; [error] [SpeakOperationHandler] agent_speak tool not found | `assets/index.ts-NvJjNdT1.js` |
| 61 | `TabRecordingPortManager` | 3 | `OFFSCREEN_MEDIA` | [error] [TabRecordingPortManager] Chunk transfer error:; [error] [TabRecordingPortManager] Failed to connect to offscreen document:; [warn] [TabRecordingPortManager] Received response for unknown request: | `assets/index.ts-NvJjNdT1.js` |
| 62 | `TodoUtils` | 3 | `GENERAL_RUNTIME` | [error] [TodoUtils] Bundled todo operations failed for <var>:; [error] [TodoUtils] Error parsing todo operations in <var>:; [error] [TodoUtils] todo_manage tool not available for <var> | `assets/index.ts-NvJjNdT1.js` |
| 63 | `UCA ${sessionId}` | 3 | `GENERAL_RUNTIME` | [error] [UCA <var>] Failed to load capabilities:; [warn] [UCA <var>] No capabilities found in registry; [warn] [UCA <var>] SystemManager not available | `assets/index.ts-NvJjNdT1.js` |
| 64 | `UIStateContext` | 3 | `GENERAL_RUNTIME` | [error] [UIStateContext] Failed to load persisted state:; [error] [UIStateContext] Failed to persist displayMode:; [error] [UIStateContext] Failed to persist state: | `assets/index.html-Dt7qjZUV.js` |
| 65 | `WorkflowCreateCapability` | 3 | `CAPABILITY_EXEC`,`VALIDATION_PARSE` | [error] [WorkflowCreateCapability] Create error:; [error] [WorkflowCreateCapability] LLM code generation failed on attempt <var>:; [warn] [WorkflowCreateCapability] Validation failed on attempt <var>: | `assets/index.ts-NvJjNdT1.js` |
| 66 | `WorkflowManager` | 3 | `GENERAL_RUNTIME`,`NOT_FOUND` | [error] [WorkflowManager] Failed to convert workflow <var>:; [error] [WorkflowManager] Failed to load workflow <var>:; [error] [WorkflowManager] workflow_get tool not found | `assets/index.ts-NvJjNdT1.js` |
| 67 | `AgentLLMCaller` | 2 | `GENERAL_RUNTIME` | [warn] [AgentLLMCaller] Could not get selected model, using session model:; [warn] [AgentLLMCaller] Failed to refresh context: | `assets/index.ts-NvJjNdT1.js` |
| 68 | `AgentOrchestrator` | 2 | `GENERAL_RUNTIME` | [error] [AgentOrchestrator] Failed to recall memories:; [error] [AgentOrchestrator] Memory operation failed: | `assets/index.ts-NvJjNdT1.js` |
| 69 | `AgentPromptBuilder` | 2 | `NETWORK_API` | [error] [AgentPromptBuilder] Failed to fetch memories:; [error] [AgentPromptBuilder] Failed to fetch todos: | `assets/index.ts-NvJjNdT1.js` |
| 70 | `BridgeManager` | 2 | `IPC_BRIDGE` | [error] [BridgeManager] Error in connection listener:; [error] [BridgeManager] Error in message listener: | `assets/index.ts-NvJjNdT1.js` |
| 71 | `CanvasResultView` | 2 | `OFFSCREEN_MEDIA` | [error] [CanvasResultView] Failed to load canvas image:; [error] [CanvasResultView] Failed to parse JSON: | `assets/index.html-Dt7qjZUV.js` |
| 72 | `CapabilityParameters` | 2 | `CAPABILITY_EXEC` | [error] [CapabilityParameters] Failed to load parameters for; [error] [CapabilityParameters] Failed to save parameters for | `assets/index.html-Dt7qjZUV.js` |
| 73 | `CapabilityPreview` | 2 | `CAPABILITY_EXEC`,`VALIDATION_PARSE` | [error] [CapabilityPreview] Error fetching tabs:; [error] [CapabilityPreview] JSON parse error on execute: | `assets/index.html-Dt7qjZUV.js` |
| 74 | `ConfigurationSearchIndex` | 2 | `GENERAL_RUNTIME` | [error] [ConfigurationSearchIndex] Failed to add configuration to MiniSearch:; [error] [ConfigurationSearchIndex] Failed to initialize MiniSearch: | `assets/index.ts-NvJjNdT1.js` |
| 75 | `ContextChainDiscovery` | 2 | `GENERAL_RUNTIME` | [error] [ContextChainDiscovery] Error during discovery:; [error] [ContextChainDiscovery] Error querying frame <var>: | `assets/utils-BJ644OfL.js` |
| 76 | `DOM Extract` | 2 | `TAB_DOM` | [error] [DOM Extract] Iframe processing error:; [warn] [DOM Extract] Cross-origin iframe extraction failed: | `src/pages/content/index.tsx.js` |
| 77 | `DomQuerySelectorAllCapability` | 2 | `TAB_DOM` | [error] [DomQuerySelectorAllCapability] Error during context discovery:; [warn] [DomQuerySelectorAllCapability] Error searching context <var>: | `assets/index.ts-NvJjNdT1.js` |
| 78 | `DomQuerySelectorCapability` | 2 | `TAB_DOM` | [error] [DomQuerySelectorCapability] Error during context discovery:; [warn] [DomQuerySelectorCapability] Error searching context <var>: | `assets/index.ts-NvJjNdT1.js` |
| 79 | `DomToFileCapability` | 2 | `TAB_DOM`,`NOT_FOUND` | [warn] [DomToFileCapability] DOM hierarchy analysis capability not found in registry; [warn] [DomToFileCapability] Hierarchy analysis failed: | `assets/index.ts-NvJjNdT1.js` |
| 80 | `FFmpegResultView` | 2 | `OFFSCREEN_MEDIA` | [error] [FFmpegResultView] Error fetching file:; [error] [FFmpegResultView] Failed to parse JSON: | `assets/index.html-Dt7qjZUV.js` |
| 81 | `FileDrawer` | 2 | `GENERAL_RUNTIME` | [error] [FileDrawer] Delete error:; [error] [FileDrawer] Download error: | `assets/index.html-Dt7qjZUV.js` |
| 82 | `FileListMessage` | 2 | `GENERAL_RUNTIME` | [error] [FileListMessage] Delete error:; [error] [FileListMessage] Download error: | `assets/index.html-Dt7qjZUV.js` |
| 83 | `FileSyncService` | 2 | `GENERAL_RUNTIME` | [error] [FileSyncService] Failed <var> for <var>:; [warn] [FileSyncService] Skipping update for <var> because reference_id is missing | `assets/index.ts-NvJjNdT1.js` |
| 84 | `ImageMagickResultView` | 2 | `OFFSCREEN_MEDIA` | [error] [ImageMagickResultView] Failed to load saved image:; [error] [ImageMagickResultView] Failed to parse JSON: | `assets/index.html-Dt7qjZUV.js` |
| 85 | `PermissionStorageService` | 2 | `AUTH_PERMISSION` | [error] [PermissionStorageService] Error loading:; [error] [PermissionStorageService] Error saving: | `assets/utils-BJ644OfL.js` |
| 86 | `PortProvider` | 2 | `IPC_BRIDGE` | [error] [PortProvider] Failed to establish port connection:; [error] [PortProvider] Runtime API not available | `assets/jsx-runtime-DosEqo4y.js` |
| 87 | `SevenZipCapability` | 2 | `GENERAL_RUNTIME`,`CAPABILITY_EXEC` | [error] [SevenZipCapability] Operation failed:; [warn] [SevenZipCapability] File <var> has no data, skipping | `assets/index.ts-NvJjNdT1.js` |
| 88 | `TokenService` | 2 | `GENERAL_RUNTIME` | [warn] [TokenService] Failed to count tokens, using estimation:; [warn] [TokenService] Failed to free encoder: | `assets/index.ts-NvJjNdT1.js` |
| 89 | `useFileData` | 2 | `GENERAL_RUNTIME`,`FILE_IO` | [error] [useFileData] Error creating blob URL:; [error] [useFileData] Error fetching file: | `assets/index.html-Dt7qjZUV.js` |
| 90 | `WakeLockManager` | 2 | `GENERAL_RUNTIME` | [warn] [WakeLockManager] Failed to acquire wake lock:; [warn] [WakeLockManager] Failed to release wake lock: | `assets/index.ts-NvJjNdT1.js` |
| 91 | `WANG Script` | 2 | `GENERAL_RUNTIME` | [error] [WANG Script] | `src/pages/content/index.tsx.js` |
| 92 | `WorkflowParameters` | 2 | `GENERAL_RUNTIME` | [error] [WorkflowParameters] Failed to load parameters for; [error] [WorkflowParameters] Failed to save parameters for | `assets/index.html-Dt7qjZUV.js` |
| 93 | `Agent` | 1 | `UI_RUNTIME` | [error] [Agent] Can't find Agent root element | `assets/index.html-Dt7qjZUV.js` |
| 94 | `AgentOrchestrationContextManager` | 1 | `GENERAL_RUNTIME` | [warn] [AgentOrchestrationContextManager] Failed to get recent titles: | `assets/index.ts-NvJjNdT1.js` |
| 95 | `AgentToolsRegistry` | 1 | `CAPABILITY_REGISTRY` | [error] [AgentToolsRegistry] Failed to initialize: | `assets/index.ts-NvJjNdT1.js` |
| 96 | `Alt+Click Selector` | 1 | `IPC_BRIDGE` | [error] [Alt+Click Selector] Port not available | `src/pages/content/index.tsx.js` |
| 97 | `AnthropicApiClient` | 1 | `AUTH_PERMISSION` | [warn] [AnthropicApiClient] Failed to get auth token: | `assets/index.ts-NvJjNdT1.js` |
| 98 | `CapabilitiesHandler` | 1 | `CAPABILITY_EXEC` | [error] [CapabilitiesHandler] Capability execution failed: | `assets/index.ts-NvJjNdT1.js` |
| 99 | `CapabilityRegistry` | 1 | `GENERAL_RUNTIME` | [warn] [CapabilityRegistry] Duplicate registration attempt for <var> v<var> | `assets/index.ts-NvJjNdT1.js` |
| 100 | `console-record-plugin` | 1 | `VALIDATION_PARSE` | [warn] [console-record-plugin]: Failed to parse error object: | `assets/UserValueTracker-DwHPs7UU.js` |
| 101 | `ConversationGetCapability` | 1 | `CAPABILITY_EXEC` | [error] [ConversationGetCapability] Error: | `assets/index.ts-NvJjNdT1.js` |
| 102 | `ConversationPersistCapability` | 1 | `CAPABILITY_EXEC` | [error] [ConversationPersistCapability] Error: | `assets/index.ts-NvJjNdT1.js` |
| 103 | `ConversationSearchCapability` | 1 | `CAPABILITY_EXEC` | [error] [ConversationSearchCapability] Error: | `assets/index.ts-NvJjNdT1.js` |
| 104 | `DomClipboardCapability` | 1 | `NETWORK_API` | [error] [DomClipboardCapability] Failed to fetch file from storage: | `assets/index.ts-NvJjNdT1.js` |
| 105 | `DomGetAccessibilityTreeCapability` | 1 | `TAB_DOM` | [warn] [DomGetAccessibilityTreeCapability] Could not check session mode, detaching debugger: | `assets/index.ts-NvJjNdT1.js` |
| 106 | `DomSetFileInputCapability` | 1 | `TAB_DOM` | [error] [DomSetFileInputCapability] File resolution failed: | `assets/index.ts-NvJjNdT1.js` |
| 107 | `ExecutionContext` | 1 | `GENERAL_RUNTIME` | [warn] [ExecutionContext] Agent UI not available | `assets/index.ts-NvJjNdT1.js` |
| 108 | `MemoryManageCapability` | 1 | `CAPABILITY_EXEC` | [warn] [MemoryManageCapability] Failed to search related memories: | `assets/index.ts-NvJjNdT1.js` |
| 109 | `MuPDF` | 1 | `OFFSCREEN_MEDIA` | [error] [MuPDF] | `assets/offscreen-3di9z-KA.js` |
| 110 | `OpenAIApiClient` | 1 | `AUTH_PERMISSION` | [warn] [OpenAIApiClient] Failed to get auth token: | `assets/index.ts-NvJjNdT1.js` |
| 111 | `PerspectiveConfigCapability` | 1 | `CAPABILITY_EXEC` | [error] [PerspectiveConfigCapability] Error: | `assets/index.ts-NvJjNdT1.js` |
| 112 | `PortContext` | 1 | `IPC_BRIDGE` | [error] [PortContext] Error in perspective config handler <var>: | `assets/jsx-runtime-DosEqo4y.js` |
| 113 | `ResultsTabView` | 1 | `FILE_IO` | [error] [ResultsTabView] Download failed for | `assets/index.html-Dt7qjZUV.js` |
| 114 | `ScreenshotResultView` | 1 | `VALIDATION_PARSE` | [error] [ScreenshotResultView] Failed to parse JSON: | `assets/index.html-Dt7qjZUV.js` |
| 115 | `SuggestedWorkflows` | 1 | `GENERAL_RUNTIME` | [error] [SuggestedWorkflows] Error previewing workflow: | `assets/index.html-Dt7qjZUV.js` |
| 116 | `SystemInitializer` | 1 | `GENERAL_RUNTIME` | [error] [SystemInitializer] Failed to initialize system: | `assets/index.ts-NvJjNdT1.js` |
| 117 | `Table` | 1 | `GENERAL_RUNTIME` | [error] [Table] Column with id '<var>' does not exist. | `assets/data-DUdtbxTw.js` |
| 118 | `TabRecordingCapability` | 1 | `OFFSCREEN_MEDIA` | [error] [TabRecordingCapability] Failed to save offscreen recording: | `assets/index.ts-NvJjNdT1.js` |
| 119 | `TextEditorGrepCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorGrepCapability] grep error: | `assets/index.ts-NvJjNdT1.js` |
| 120 | `TextEditorInsertCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorInsertCapability] insert error: | `assets/index.ts-NvJjNdT1.js` |
| 121 | `TextEditorReplaceBulkCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorReplaceBulkCapability] bulk replace error: | `assets/index.ts-NvJjNdT1.js` |
| 122 | `TextEditorReplaceCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorReplaceCapability] replace error: | `assets/index.ts-NvJjNdT1.js` |
| 123 | `TextEditorUndoCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorUndoCapability] undo error: | `assets/index.ts-NvJjNdT1.js` |
| 124 | `TextEditorViewCapability` | 1 | `CAPABILITY_EXEC` | [error] [TextEditorViewCapability] view error: | `assets/index.ts-NvJjNdT1.js` |
| 125 | `URLDownloadCapability` | 1 | `CAPABILITY_EXEC` | [error] [URLDownloadCapability] Download failed: | `assets/index.ts-NvJjNdT1.js` |
| 126 | `useClipboardWorkflow` | 1 | `GENERAL_RUNTIME` | [error] [useClipboardWorkflow] Failed to process pasted files: | `assets/index.html-Dt7qjZUV.js` |
| 127 | `useDragDropFiles` | 1 | `GENERAL_RUNTIME` | [error] [useDragDropFiles] Error processing dropped files: | `assets/index.html-Dt7qjZUV.js` |
| 128 | `useFilesData` | 1 | `NETWORK_API` | [error] [useFilesData] Failed to fetch files: | `assets/index.html-Dt7qjZUV.js` |
| 129 | `useModelSelection` | 1 | `GENERAL_RUNTIME` | [error] [useModelSelection] Failed to load selected model: | `assets/index.html-Dt7qjZUV.js` |
| 130 | `UserInteractionRecordingCapability` | 1 | `CAPABILITY_EXEC` | [error] [UserInteractionRecordingCapability] Failed to toggle speech recording: | `assets/index.ts-NvJjNdT1.js` |
| 131 | `useTabsData` | 1 | `NETWORK_API` | [error] [useTabsData] Failed to fetch tabs: | `assets/index.html-Dt7qjZUV.js` |
| 132 | `Wang Executor Error` | 1 | `GENERAL_RUNTIME` | [error] [Wang Executor Error] Failed to route error to agent: | `assets/index.ts-NvJjNdT1.js` |
| 133 | `WangUIErrorBoundary` | 1 | `UI_RUNTIME` | [error] [WangUIErrorBoundary] Failed to notify agent: | `assets/ai-ui-BhwdKz5d.js` |
| 134 | `workflow_execute` | 1 | `GENERAL_RUNTIME` | [warn] [workflow_execute] Ignoring explicit context="<var>", using workflow_type="<var>" → <var> | `assets/index.ts-NvJjNdT1.js` |
| 135 | `WorkflowDeleteCapability` | 1 | `CAPABILITY_EXEC` | [error] [WorkflowDeleteCapability] Delete error: | `assets/index.ts-NvJjNdT1.js` |
| 136 | `WorkflowExecuteCapability` | 1 | `VALIDATION_PARSE` | [warn] [WorkflowExecuteCapability] AST parse failed, defaulting to serviceworker: | `assets/index.ts-NvJjNdT1.js` |
| 137 | `WorkflowGetCapability` | 1 | `CAPABILITY_EXEC` | [error] [WorkflowGetCapability] Get error: | `assets/index.ts-NvJjNdT1.js` |
| 138 | `WorkflowList` | 1 | `GENERAL_RUNTIME` | [error] [WorkflowList] Failed to load recent workflows: | `assets/index.html-Dt7qjZUV.js` |
| 139 | `WorkflowSearchCapability` | 1 | `CAPABILITY_EXEC` | [error] [WorkflowSearchCapability] Search error: | `assets/index.ts-NvJjNdT1.js` |
| 140 | `WorkflowTestCapability` | 1 | `CAPABILITY_EXEC` | [error] [WorkflowTestCapability] test error: | `assets/index.ts-NvJjNdT1.js` |
| 141 | `WorkflowUpdateCapability` | 1 | `CAPABILITY_EXEC` | [error] [WorkflowUpdateCapability] Update error: | `assets/index.ts-NvJjNdT1.js` |

## No-Prefix Errors (`(no-prefix)`)
- These are mostly third-party/library throws plus generic runtime guards. Use kind + message stem.
| Kind ID | Count | Representative Stems |
|---|---:|---|
| `TAB_DOM` | 38 | [throw] Can't find 'DOMParser' in 'globalThis', please provide it via options; [throw] Could not determine current tab ID; [throw] DomUtils not loaded; [throw] Empty selector provided for operation |
| `GENERAL_RUNTIME` | 27 | [throw] Could not find a suitable point for the given distance; [throw] Database corruption detected and recovery failed: <var>; [throw] Database not initialized; [throw] Failed to create workflow: <var> |
| `MISSING_INPUT` | 15 | [throw] A valid DOM element is required.; [throw] Either workflowName or code must be provided; [throw] ExecutionContext is required for workflow execution; [throw] Invalid workflow definition - must have jslike code |
| `INVALID_INPUT` | 13 | [throw] Cannot inject into protected tab: <var>; [throw] Cannot set tokens provider for unknown language <var>; [throw] Database already exists, cannot load from tarball; [throw] Invalid path format. Use workflow://name or document://key |
| `SCHEDULER` | 9 | [throw] Either periodInMinutes or when is required for schedule operation; [throw] Either scheduleId or workflowId is required for get operation; [throw] Either scheduleId or workflowId is required for unschedule operation; [throw] Schedule not found: <var> |
| `OFFSCREEN_MEDIA` | 8 | [throw] 7z initialization failed; [throw] Cannot create MuPDF context!; [throw] FFmpeg not initialized; [throw] Failed to fetch 7z WASM: <var> |
| `IPC_BRIDGE` | 4 | [throw] RRDomException: Failed to execute 'appendChild' on 'RRNode': This RRNode type does not support this method.; [throw] RRDomException: Failed to execute 'insertBefore' on 'RRNode': This RRNode type does not support this method.; [throw] RRDomException: Failed to execute 'removeChild' on 'RRNode': This RRNode type does not support this method.; [throw] Unknown authenticationOk message type |
| `NOT_FOUND` | 3 | [throw] Capability not found: <var>; [throw] File not found in storage: <var>; [throw] Table cell renderer for template id <var> not found. |
| `STORAGE_DB` | 3 | [throw] Database or search index not initialized; [throw] Memory storage limit reached (10,000 memories). Please cleanup old memories.; [throw] No image data found for storageKey |
| `NETWORK_API` | 2 | [throw] Failed to fetch capability details; [throw] Failed to fetch workflows |
| `CAPABILITY_REGISTRY` | 1 | [throw] CapabilityRegistry not available |
| `WORKFLOW_NOT_FOUND` | 1 | [throw] Workflow not found: <var> |

## Fast Routing Rules (Log -> Fix Prompt)
- If prefix contains `Offscreen`, `FFmpeg`, `MuPDF`, `7z`, `ImageMagick`, or `Canvas` -> use `OFFSCREEN_MEDIA` prompt.
- If message contains `unknown message type`, `port`, `bridge`, `chunk transfer`, `timeout` -> start with `IPC_BRIDGE` then `TIMEOUT_CANCEL` if needed.
- If message contains `Workflow not found` -> use `WORKFLOW_NOT_FOUND` prompt.
- If message contains `is required`, `must have`, `cannot be null` -> use `MISSING_INPUT` prompt.
- If message contains `Invalid`, `Unknown`, `Unsupported` -> use `INVALID_INPUT` prompt.
- If message contains `validation failed`, `schema`, `parse` -> use `VALIDATION_PARSE` prompt.
- If prefix contains `WorkflowContext`, `WorkflowHandler`, `WangWorkflowExecutor` and mentions execution failure -> use `CAPABILITY_EXEC` + `NETWORK_API` or `TAB_DOM` based on surrounding logs.
- If prefix contains `ContentScript`, `ManagedTab`, `Selector`, `Inspector`, `Dom...Capability` -> use `TAB_DOM` prompt.
- If prefix contains `ConfigurationStorage`, `ConversationSession`, `IndexedDB`, `FileStorage` -> use `STORAGE_DB` prompt.
- If prefix contains `Permission`, `Auth`, `Token` -> use `AUTH_PERMISSION` prompt.
- If prefix contains `AlarmManager` -> use `SCHEDULER` prompt.

## Practical Prompt Recipe
Use this structure when sending logs to the agent:
```text
Here are failing console logs from the extension run:
<paste logs>

Match them against logs-understanding.md and apply Kind ID(s): <KIND_IDS>.
Please:
1) identify the exact failing module and call path,
2) propose minimal code changes,
3) implement the patch,
4) add/adjust validation and diagnostics,
5) list how to verify the fix end-to-end.
```