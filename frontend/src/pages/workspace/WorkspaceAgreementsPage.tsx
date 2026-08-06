import React from 'react'
import { AgreementsManager } from '@/components/admin/AgreementsManager'

/** Свои регламенты видят все роли воркспейса; управление — только админ. */
export const WorkspaceAgreementsPage: React.FC = () => <AgreementsManager colorPrefix="w" />
