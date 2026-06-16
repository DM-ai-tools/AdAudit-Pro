import type { CampaignDto } from '../services/google-ads.service.js';

export const MOCK_CAMPAIGNS_BY_ACCOUNT: Record<string, CampaignDto[]> = {
  '123-456-7890': [
    {
      id: '1001',
      resourceName: 'customers/1234567890/campaigns/1001',
      name: 'Brand Search — Plumbing',
      type: 'SEARCH',
      status: 'ENABLED',
      budgetDaily: 120,
      impressions: 45200,
      clicks: 1890,
      conversions: 84,
      ctr: 4.2,
      cost: 3420,
      adCount: 3,
    },
    {
      id: '1002',
      resourceName: 'customers/1234567890/campaigns/1002',
      name: 'Emergency Plumber — Sydney',
      type: 'SEARCH',
      status: 'ENABLED',
      budgetDaily: 85,
      impressions: 28400,
      clicks: 1120,
      conversions: 52,
      ctr: 3.9,
      cost: 2180,
      adCount: 2,
    },
    {
      id: '1003',
      resourceName: 'customers/1234567890/campaigns/1003',
      name: 'Performance Max — Services',
      type: 'PERFORMANCE_MAX',
      status: 'ENABLED',
      budgetDaily: 200,
      impressions: 98000,
      clicks: 4200,
      conversions: 110,
      ctr: 4.3,
      cost: 5600,
      adCount: 0,
    },
  ],
  '555-123-4567': [
    {
      id: '2001',
      resourceName: 'customers/5551234567/campaigns/2001',
      name: 'Electrical Services',
      type: 'SEARCH',
      status: 'ENABLED',
      budgetDaily: 65,
      impressions: 18200,
      clicks: 720,
      conversions: 28,
      ctr: 4.0,
      cost: 980,
      adCount: 1,
    },
  ],
};

export function getMockCampaigns(customerId: string): CampaignDto[] {
  const normalized = customerId.replace(/-/g, '');
  for (const [key, campaigns] of Object.entries(MOCK_CAMPAIGNS_BY_ACCOUNT)) {
    if (key.replace(/-/g, '') === normalized) return campaigns;
  }
  return [];
}
