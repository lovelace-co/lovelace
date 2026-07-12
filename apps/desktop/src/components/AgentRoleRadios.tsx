import type { AgentRole } from '../lib/schemaRows';

const ROLES: Array<{ value: AgentRole | undefined; label: string }> = [
  { value: undefined, label: 'None' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
];

interface AgentRoleRadiosProps {
  name: string;
  value: AgentRole | undefined;
  onChange: (next: AgentRole | undefined) => void;
  'aria-label'?: string;
}

/**
 * The status row's agent-role choice: a radio group of None / Ready / In
 * Progress / Complete, one selection per row. Shares the punchcard-hole
 * visual language with HoleCheck (a rimmed circle that punches in when
 * selected) rather than inventing a new control species.
 */
export function AgentRoleRadios({ name, value, onChange, 'aria-label': ariaLabel }: AgentRoleRadiosProps) {
  return (
    <div className="role-radios" role="radiogroup" aria-label={ariaLabel}>
      {ROLES.map((role) => {
        const key = role.value ?? 'none';
        return (
          <label key={key} className="role-radio">
            <input
              type="radio"
              name={name}
              aria-label={`${ariaLabel ?? name} ${role.label}`}
              checked={value === role.value}
              onChange={() => onChange(role.value)}
            />
            <span className="role-radio-mark" aria-hidden />
            <span className="role-radio-label">{role.label}</span>
          </label>
        );
      })}
    </div>
  );
}
