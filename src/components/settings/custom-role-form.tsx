"use client";

import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertCustomRoleAction } from "@/server/use-cases/roles";
import { PERMISSION_GROUP_LABELS, type PermissionGroupId } from "@/lib/rbac/permission-groups";
import { useI18n } from "@/lib/i18n/client";

type Dept = { id: string; name: string };

export function CustomRoleForm({
  departments,
  groups,
  role,
}: {
  departments: Dept[];
  groups: Array<{ id: PermissionGroupId; labelAr: string; keys: string[] }>;
  role?: {
    id: string;
    name_ar: string;
    name_en: string;
    code: string;
    department_id: string | null;
    permission_keys: string[];
  };
}) {
  const { t, locale } = useI18n();
  const tf = t.workspace.roles.form;
  const orderedGroups =
    locale === "en"
      ? [...groups].sort((a, b) => PERMISSION_GROUP_LABELS[a.id].en.localeCompare(PERMISSION_GROUP_LABELS[b.id].en, "en"))
      : groups;
  const selected = new Set(role?.permission_keys ?? []);
  return (
    <ServerActionForm action={upsertCustomRoleAction} className="grid gap-3" testId={role ? `role-edit-${role.id}` : "role-create-form"}>
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={tf.nameAr} required>
          <Input name="name_ar" required defaultValue={role?.name_ar ?? ""} data-testid="role-name-ar" />
        </Field>
        <Field label={tf.nameEn} required>
          <Input name="name_en" required defaultValue={role?.name_en ?? ""} data-testid="role-name-en" />
        </Field>
        {role ? (
          <Field label={tf.code} hint={tf.codeFixed}>
            <Input name="code_display" value={role.code} disabled readOnly />
          </Field>
        ) : (
          <Field label={tf.codeOptional} hint={tf.codeHint}>
            <Input name="code" defaultValue="" data-testid="role-code" />
          </Field>
        )}
        <Field label={tf.department} hint={tf.departmentHint}>
          <Select name="department_id" defaultValue={role?.department_id ?? ""} data-testid="role-department">
            <option value="">{tf.none}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-muted">{tf.sensitiveNote}</p>
      <div className="grid gap-4" data-testid="role-permission-picker">
        {orderedGroups.map((group) => (
          <fieldset key={group.id} className="rounded-[var(--radius-control)] border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink">{PERMISSION_GROUP_LABELS[group.id]?.[locale] ?? group.labelAr}</legend>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.keys.map((key) => (
                <li key={key}>
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="permission_keys"
                      value={key}
                      defaultChecked={selected.has(key)}
                      className="mt-1"
                    />
                    <span className="font-mono text-xs">{key}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <Button type="submit">{role ? tf.saveChanges : tf.create}</Button>
    </ServerActionForm>
  );
}
