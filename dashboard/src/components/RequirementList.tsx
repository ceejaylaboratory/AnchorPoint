import type { FieldRequirement } from '../types';

export const RequirementList = ({ title, fields }: { title: string; fields: FieldRequirement[] }) => (
  <div className="glass-card p-5">
    <div className="flex items-center justify-between gap-4">
      <h3 className="text-base font-semibold" id={`req-list-${title.replace(/\s+/g, '-').toLowerCase()}`}>
        {title}
      </h3>
      <span className="text-xs uppercase tracking-[0.2em] text-slate-500" aria-hidden="true">
        {fields.length} fields
      </span>
    </div>
    <ul
      className="mt-4 space-y-3 list-none p-0 m-0"
      aria-labelledby={`req-list-${title.replace(/\s+/g, '-').toLowerCase()}`}
      aria-label={`${title}: ${fields.length} field${fields.length !== 1 ? 's' : ''}`}
    >
      {fields.map((field) => (
        <li key={field.key} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-slate-100">{field.label}</p>
            <span
              className={`text-xs font-semibold ${field.required ? 'text-amber-300' : 'text-slate-500'}`}
              aria-label={field.required ? 'Required field' : 'Optional field'}
            >
              {field.required ? 'Required' : 'Optional'}
            </span>
          </div>
          {field.placeholder ? (
            <p className="mt-1 text-sm text-slate-500">
              <span className="sr-only">Example: </span>
              {field.placeholder}
            </p>
          ) : null}
          {field.helpText ? <p className="mt-1 text-sm text-slate-400">{field.helpText}</p> : null}
        </li>
      ))}
    </ul>
  </div>
);

export default RequirementList;
