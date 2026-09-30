import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select } from "@base-ui/react/select";
import type { PersonRecord } from "../lib/types";

/** Accessible person picker used by the recovery-import form. */
export function PersonSelect({ people, name }: { people: PersonRecord[]; name: string }) {
  const items = useMemo(() => people.map((person) => ({ value: person.id, label: person.name })), [people]);
  const [selectedValue, setSelectedValue] = useState<string | null>(people[0]?.id ?? null);

  useEffect(() => {
    if (people.length === 0) {
      setSelectedValue(null);
      return;
    }
    setSelectedValue((current) =>
      current && people.some((person) => person.id === current) ? current : people[0].id,
    );
  }, [people]);

  return (
    <Select.Root
      name={name}
      required
      disabled={people.length === 0}
      items={items}
      value={selectedValue}
      onValueChange={(value) => setSelectedValue(value)}
    >
      <Select.Trigger className="select-trigger" aria-label="Choose person">
        <Select.Value placeholder={people.length === 0 ? "Add a person first" : "Choose person"} />
        <Select.Icon className="select-icon">
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="select-positioner" sideOffset={6}>
          <Select.Popup className="select-popup">
            {people.map((person) => (
              <Select.Item className="select-item" key={person.id} value={person.id}>
                <Select.ItemText>
                  <span>{person.name}</span>
                  <small>{person.caseCount} {person.caseCount === 1 ? "case" : "cases"}</small>
                </Select.ItemText>
                <Select.ItemIndicator className="select-indicator">
                  <Check size={15} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
