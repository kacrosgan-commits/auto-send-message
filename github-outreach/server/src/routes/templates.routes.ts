import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validate } from '../middleware/validation.middleware';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  previewTemplate,
  updateTemplate,
} from '../services/template.service';
import { TEMPLATE_VARIABLES } from '../types';

export const templatesRouter = Router();

const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

templatesRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    res.json({ templates: await listTemplates(), variables: TEMPLATE_VARIABLES });
  }),
);

templatesRouter.post(
  '/',
  validate({ body: templateBody }),
  asyncRoute(async (req, res) => {
    const template = await createTemplate(req.body);
    res.status(201).json({ template });
  }),
);

templatesRouter.post(
  '/preview',
  validate({
    body: z.object({
      templateId: z.string().min(1).max(64).optional(),
      subject: z.string().max(200).optional(),
      body: z.string().max(20000).optional(),
      contactIds: z.array(z.string().min(1).max(64)).min(1).max(500),
    }),
  }),
  asyncRoute(async (req, res) => {
    const previews = await previewTemplate(req.body);
    res.json({ previews });
  }),
);

templatesRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    body: templateBody.partial().refine((value) => Object.keys(value).length > 0, 'Nothing to update.'),
  }),
  asyncRoute(async (req, res) => {
    const template = await updateTemplate(paramId(req.params.id), req.body);
    res.json({ template });
  }),
);

templatesRouter.delete(
  '/:id',
  validate({ params: z.object({ id: z.string().min(1).max(64) }) }),
  asyncRoute(async (req, res) => {
    await deleteTemplate(paramId(req.params.id));
    res.json({ ok: true });
  }),
);

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}
