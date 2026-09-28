export interface ContactMetadata {
  username: string;
  displayName: string | null;
  email: string;
  githubUrl: string;
  avatarUrl: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  searchKeyword: string | null;
  source: string;
  status: string;
}

export function planContactSave(existingEmail: string | null): 'create' | 'update' {
  return existingEmail ? 'update' : 'create';
}

export function mergeContactMetadata<T extends ContactMetadata>(existing: T, incoming: ContactMetadata): T {
  return {
    ...existing,
    username: incoming.username || existing.username,
    displayName: incoming.displayName ?? existing.displayName,
    githubUrl: incoming.githubUrl || existing.githubUrl,
    avatarUrl: incoming.avatarUrl ?? existing.avatarUrl,
    bio: incoming.bio ?? existing.bio,
    company: incoming.company ?? existing.company,
    location: incoming.location ?? existing.location,
    searchKeyword: incoming.searchKeyword ?? existing.searchKeyword,
    email: existing.email,
    status: existing.status,
    source: existing.source || incoming.source,
  };
}
