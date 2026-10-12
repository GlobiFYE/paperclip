import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import {
  DraftInput,
  Field,
  ToggleField,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Prepended to the Copilot prompt at runtime.";

export function CopilotLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  return configFieldsForSection(section, (
    <>
      {!hideInstructionsFile && (
      <Field label="Agent instructions file" hint={instructionsFileHint}>
        <div className="flex items-center gap-2">
          <DraftInput
            value={
              isCreate
                ? values!.instructionsFilePath ?? ""
                : eff(
                    "adapterConfig",
                    "instructionsFilePath",
                    String(config.instructionsFilePath ?? ""),
                  )
            }
            onCommit={(v) =>
              isCreate
                ? set!({ instructionsFilePath: v })
                : mark("adapterConfig", "instructionsFilePath", v || undefined)
            }
            immediate
            className={inputClass}
            placeholder="/absolute/path/to/AGENTS.md"
          />
          <ChoosePathButton />
        </div>
      </Field>
      )}
      {/* The create-time config builder does not emit these flags, so they are edit-only. */}
      {!isCreate && (
        <>
          <ToggleField
            label="Allow all paths"
            hint="Pass --allow-all-paths so Copilot may access any filesystem path without prompting."
            checked={eff("adapterConfig", "allowAllPaths", config.allowAllPaths === true)}
            onChange={(v) => mark("adapterConfig", "allowAllPaths", v)}
          />
          <ToggleField
            label="Disable built-in MCP servers"
            hint="Pass --disable-builtin-mcps to turn off Copilot's bundled MCP servers (e.g. GitHub)."
            checked={eff("adapterConfig", "disableBuiltinMcps", config.disableBuiltinMcps === true)}
            onChange={(v) => mark("adapterConfig", "disableBuiltinMcps", v)}
          />
        </>
      )}
    </>
  ));
}
