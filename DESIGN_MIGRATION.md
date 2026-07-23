# Design System Migration Guide

## Completed ✅

### Color System & Tailwind Config
- ✅ Added `ds-` color classes to tailwind.config.js
- ✅ Updated CSS variables in index.css (.crm-shell) to match exact hex values
- ✅ Colors now match external repo's design system perfectly

### UI Components Created
- ✅ AppButton (primary, ghost, subtle, danger)
- ✅ AppInput (with labels, error states)
- ✅ AppCard (for containers)
- ✅ StatCard (for statistics display)
- ✅ PriorityPill (task priority badges)
- ✅ StatusPill (task status badges)
- ✅ SegmentedTabs (tab navigation)
- ✅ EmptyState (empty state containers)

### Pages Updated
- ✅ PortalHomePage - using StatCard
- ✅ PortalProfilePage - using AppCard, AppInput, AppButton

### Build Status
- ✅ TypeScript compilation: PASSING
- ✅ Vite build: SUCCESSFUL

---

## How to Update Remaining Pages

### Pattern 1: Replace Button from shadcn/ui
```tsx
// BEFORE
import { Button } from '@/components/ui/button'
<Button onClick={handler}>Click me</Button>

// AFTER
import { AppButton } from '@/components/ui'
<AppButton onClick={handler}>Click me</AppButton>

// With variants:
<AppButton variant="ghost">Ghost Button</AppButton>
<AppButton variant="subtle">Subtle Button</AppButton>
<AppButton variant="danger">Delete</AppButton>
```

### Pattern 2: Replace Input from shadcn/ui
```tsx
// BEFORE
import { Input } from '@/components/ui/input'
<Input placeholder="Enter text" />

// AFTER
import { AppInput } from '@/components/ui'
<AppInput placeholder="Enter text" label="Field Label" />
<AppInput type="email" error={errorMessage} />
```

### Pattern 3: Replace Card Containers
```tsx
// BEFORE
<div className="rounded-[16px] border border-p-line bg-p-panel p-5">
  {children}
</div>

// AFTER
import { AppCard } from '@/components/ui'
<AppCard>
  {children}
</AppCard>
```

### Pattern 4: Replace Empty States
```tsx
// BEFORE
<div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
  <CheckSquare className="w-5 h-5 text-brand" />
  <h2>No tasks</h2>
  <p>Tasks will appear soon</p>
</div>

// AFTER
import { EmptyState } from '@/components/ui'
<EmptyState
  icon={<CheckSquare className="w-5 h-5" />}
  title="No tasks"
  description="Tasks will appear soon"
/>
```

### Pattern 5: Replace Tab Components
```tsx
// BEFORE
<Tab active={active} onClick={onClick}>Label</Tab>

// AFTER
import { SegmentedTabs } from '@/components/ui'
<SegmentedTabs
  tabs={[
    { value: 'open', label: 'Open · 5' },
    { value: 'done', label: 'Done · 10' }
  ]}
  value={tab}
  onChange={setTab}
/>
```

### Pattern 6: Replace Stat Cards
```tsx
// BEFORE
<div className="...custom stat styles...">
  <div>{value}</div>
  <div>{label}</div>
</div>

// AFTER
import { StatCard } from '@/components/ui'
<StatCard
  icon={<IconComponent />}
  label="Label"
  value="100"
  sub="additional info"
  warn={isWarning}
/>
```

---

## Color Token Reference

All pages should use these CSS variables (already updated in index.css):
- `text-p-text` - main text (#F5F5F3)
- `text-p-muted` - secondary text (#9A9A94)
- `text-p-muted2` - tertiary text (#6E6E68)
- `text-brand` - accent text (#FFD400)
- `text-p-good` - success color (#8BD46A)
- `bg-p-bg` - main background (#0A0A0A)
- `bg-p-panel` - card/panel background (#141414)
- `bg-p-panel2` - soft panel (#1C1C1C)
- `border-p-line` - borders (#2A2A2A)

---

## Pages to Update

### Portal Pages (15 total, 2 done, 13 remaining)
- ✅ PortalHomePage
- ✅ PortalProfilePage
- [ ] PortalTasksPage
- [ ] PortalRoadmapPage
- [ ] PortalNotesPage
- [ ] PortalMeetingsPage
- [ ] PortalDocumentsPage
- [ ] PortalChatPage
- [ ] PortalCountriesPage
- [ ] PortalUniversitiesPage
- [ ] PortalScholarshipsPage
- [ ] PortalQuestionnairesPage
- [ ] PortalImportantNotesPage
- [ ] PortalNotificationsPage
- [ ] PortalPlaceholder

### Workspace Pages (15 total, 0 done, 15 remaining)
- [ ] WorkspaceDashboardPage
- [ ] WorkspaceStudentDetailPage
- [ ] WorkspaceStudentsPage
- [ ] WorkspaceTasksPage
- [ ] WorkspaceRoadmapPage
- [ ] WorkspaceNotesPage
- [ ] WorkspaceMeetingsPage
- [ ] WorkspaceDocumentsPage
- [ ] WorkspaceChatPage
- [ ] WorkspaceCountriesPage
- [ ] WorkspaceUniversitiesPage
- [ ] WorkspaceScholarshipsPage
- [ ] WorkspaceQuestionnairesPage
- [ ] WorkspaceNotificationsPage
- [ ] WorkspaceCountriesPage

---

## Automated Find & Replace Commands

Use these patterns to quickly update multiple files:

### Replace import statements
Find: `import { Button } from '@/components/ui/button'`
Replace: `import { AppButton } from '@/components/ui'`

### Replace component usage
Find: `<Button `
Replace: `<AppButton `

### Replace card containers
Find: `className="rounded-\[16px\] border border-p-line bg-p-panel p-[45]"`
Replace: `className="rounded-\[16px\] border border-p-line bg-p-panel p-\1"` → then wrap in `<AppCard>`

---

## Testing Checklist

After updating each page:
- [ ] TypeScript compiles without errors
- [ ] Page renders without visual glitches
- [ ] Colors are consistent with design system
- [ ] Buttons have proper hover states
- [ ] Forms work correctly
- [ ] Responsive layout intact

---

## Next Steps

1. Update remaining portal pages using patterns above
2. Update workspace pages
3. Test all pages in browser
4. Verify color consistency across all pages
5. Check responsive design on mobile
6. Review hover/active states on all interactive elements
