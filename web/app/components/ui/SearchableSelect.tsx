import { Combobox } from "@base-ui/react/combobox";
import { FiCheck, FiChevronDown } from "react-icons/fi";
import { cn } from "~/lib/utils";

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  searchTerms = {},
  placeholder,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  searchTerms?: Readonly<Record<string, string>>;
  placeholder: string;
  className?: string;
}) {
  return (
    <Combobox.Root
      items={options}
      filter={(option, query) =>
        `${option} ${searchTerms[option] ?? ""}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      }
      value={value || null}
      onValueChange={(nextValue) => onChange(nextValue ?? "")}
      autoHighlight
    >
      <Combobox.InputGroup className="relative">
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          className={cn(
            "w-full border border-ink bg-surface pr-10 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            className,
          )}
        />
        <Combobox.Trigger
          aria-label="Show options"
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted"
        >
          <FiChevronDown aria-hidden="true" className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50" sideOffset={4}>
          <Combobox.Popup
            className="max-h-64 overflow-y-auto border-2 border-ink bg-surface shadow-hard"
            style={{ width: "var(--anchor-width)" }}
          >
            <Combobox.Empty className="px-3 py-2.5 font-body text-sm text-muted">
              No matching option
            </Combobox.Empty>
            <Combobox.List>
              {(option: string) => (
                <Combobox.Item
                  key={option}
                  value={option}
                  className="grid cursor-pointer grid-cols-[1rem_1fr] items-center gap-2 px-3 py-2.5 font-body text-sm text-ink outline-none hover:bg-accent-soft data-highlighted:bg-accent-soft"
                >
                  <Combobox.ItemIndicator>
                    <FiCheck aria-hidden="true" className="size-4" />
                  </Combobox.ItemIndicator>
                  <span>{option}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
