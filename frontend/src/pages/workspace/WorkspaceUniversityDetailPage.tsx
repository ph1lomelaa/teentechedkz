import React from 'react'
import { UniversityDetail } from '@/components/portal/UniversityDetail'

// Same detail view as the student portal, rendered inside the workspace shell.
// StudentRoute and WorkspaceRoute are mutually exclusive, so the page needs a
// wrapper on each side rather than one shared route.
export const WorkspaceUniversityDetailPage: React.FC = () => (
  <UniversityDetail basePath="/workspace/universities" />
)
