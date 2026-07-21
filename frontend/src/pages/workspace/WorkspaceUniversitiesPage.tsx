import React from 'react'
import { UniversitiesCatalog } from '@/components/portal/UniversitiesCatalog'

// Staff/mentor universities catalog — same donor-style catalog as the student
// portal, rendered inside the workspace shell (p-* tokens resolve there too).
export const WorkspaceUniversitiesPage: React.FC = () => <UniversitiesCatalog eyebrow="Кабинет ментора" />
