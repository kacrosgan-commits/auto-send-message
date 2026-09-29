import { prisma } from '../lib/prisma';
import { AppError } from '../utils/errors';
import { contextFromContact, hasUnresolved, interpolate } from '../utils/template';
import { logger } from '../utils/logger';

const DEFAULT_TEMPLATE = {
  name: 'Quick question',
  subject: 'Quick question about your GitHub work',
  body: `Hi {{first_name | default:"there"}},

I came across your GitHub profile while looking for developers working with {{search_keyword}}.

Your background caught my attention, and I wanted to reach out regarding a project that may be relevant to your experience.

Would you be open to a quick conversation?

Best,
Tim`,
};

export async function ensureDefaultTemplate(): Promise<void> {
  const count = await prisma.template.count();
  if (count > 0) return;
  await prisma.template.create({ data: DEFAULT_TEMPLATE });
  logger.info('[Template] Seeded default template');
}

export async function listTemplates() {
  return prisma.template.findMany({ orderBy: { updatedAt: 'desc' } });
}

export async function getTemplate(id: string) {
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) throw new AppError(404, 'Template not found.', 'NOT_FOUND');
  return template;
}

export async function createTemplate(input: { name: string; subject: string; body: string }) {
  const template = await prisma.template.create({ data: input });
  logger.info({ templateId: template.id }, '[Template] Created');
  return template;
}

export async function updateTemplate(
  id: string,
  input: { name?: string; subject?: string; body?: string },
) {
  await getTemplate(id);
  return prisma.template.update({ where: { id }, data: input });
}

export async function deleteTemplate(id: string) {
  await getTemplate(id);
  await prisma.template.delete({ where: { id } });
  logger.info({ templateId: id }, '[Template] Deleted');
}

export async function previewTemplate(input: {
  templateId?: string;
  subject?: string;
  body?: string;
  contactIds: string[];
}) {
  let subject = input.subject;
  let body = input.body;
  if (!subject || !body) {
    if (!input.templateId) {
      throw new AppError(400, 'Choose a template before previewing.', 'TEMPLATE');
    }
    const template = await getTemplate(input.templateId);
    subject = subject || template.subject;
    body = body || template.body;
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: input.contactIds } },
  });
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));

  return input.contactIds.map((contactId) => {
    const contact = byId.get(contactId);
    if (!contact) {
      return {
        contactId,
        name: 'Unknown contact',
        to: '',
        subject: subject ?? '',
        body: body ?? '',
        missing: ['contact'],
      };
    }
    const context = contextFromContact(contact);
    const renderedSubject = interpolate(subject ?? '', context);
    const renderedBody = interpolate(body ?? '', context);
    const missing = [...new Set([...renderedSubject.missing, ...renderedBody.missing])];
    return {
      contactId,
      name: contact.displayName || contact.username,
      username: contact.username,
      to: contact.email,
      subject: renderedSubject.text,
      body: renderedBody.text,
      missing,
      blocked: hasUnresolved(renderedSubject.text) || hasUnresolved(renderedBody.text),
    };
  });
}
