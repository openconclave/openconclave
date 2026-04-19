export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  supportsModelList: boolean;
}

export type ProviderDraft = Omit<ProviderInfo, "apiKey"> & { apiKey?: string };
