import React from 'react'
import { CountryDetail } from '@/components/shared/CountryDetail'

export const WorkspaceCountryDetailPage: React.FC = () => (
  <CountryDetail basePath="/workspace/countries" universitiesPath="/workspace/universities" />
)
