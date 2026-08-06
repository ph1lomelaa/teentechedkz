import React from 'react'
import { CountryDetail } from '@/components/shared/CountryDetail'

export const CountryDetailPage: React.FC = () => (
  <CountryDetail basePath="/countries" universitiesPath="/universities" />
)
