import { Autocomplete } from "@base-ui/react/autocomplete";
import { FiChevronDown } from "react-icons/fi";
import { cn } from "~/lib/utils";

export function FreeTextAutocomplete({
  id,
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder: string;
  className?: string;
}) {
  return (
    <Autocomplete.Root
      items={options}
      value={value}
      onValueChange={onChange}
      openOnInputClick
      autoHighlight
    >
      <Autocomplete.InputGroup className="relative">
        <Autocomplete.Input
          id={id}
          placeholder={placeholder}
          className={cn(
            "w-full border border-ink bg-surface pr-10 font-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            className,
          )}
        />
        <Autocomplete.Trigger
          aria-label="Show suggestions"
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted"
        >
          <FiChevronDown aria-hidden="true" className="size-4" />
        </Autocomplete.Trigger>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="z-50" sideOffset={4}>
          <Autocomplete.Popup
            className="max-h-64 overflow-y-auto border-2 border-ink bg-surface shadow-hard"
            style={{ width: "var(--anchor-width)" }}
          >
            <Autocomplete.Empty className="px-3 py-2.5 font-body text-sm text-muted">
              No suggestion. Keep typing to use your own program.
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(option: string) => (
                <Autocomplete.Item
                  key={option}
                  value={option}
                  className="cursor-pointer px-3 py-2.5 font-body text-sm text-ink outline-none hover:bg-accent-soft data-highlighted:bg-accent-soft"
                >
                  {option}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
