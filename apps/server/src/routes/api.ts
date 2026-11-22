import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateCard,
  CreateProject,
  CreateThread,
  MoveCard,
  UpdateCard,
  UpdateProject,
  UpdateSettings,
  UpdateThread,
} from '@taskboard/shared';
import type { Store } from '../store';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

/** The JSON API under /api/v1. Every route needs a signed-in user. */
export async function apiRoutes(app: FastifyInstance, { store }: { store: Store }) {
  app.addHook('preHandler', app.requireUser);

  app.get('/board', () => store.snapshot());

  app.get('/cards/:id', (req) => store.getCard(IdParams.parse(req.params).id));
  app.get('/cards/:id/activity', (req) => store.activityFor(IdParams.parse(req.params).id));

  app.post('/cards', async (req, reply) => {
    reply.code(201);
    return store.createCard(CreateCard.parse(req.body));
  });
  app.patch('/cards/:id', (req) => store.updateCard(IdParams.parse(req.params).id, UpdateCard.parse(req.body)));
  app.post('/cards/:id/move', (req) => store.moveCard(IdParams.parse(req.params).id, MoveCard.parse(req.body)));
  app.delete('/cards/:id', async (req, reply) => {
    await store.deleteCard(IdParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post('/projects', async (req, reply) => {
    reply.code(201);
    return store.createProject(CreateProject.parse(req.body));
  });
  app.patch('/projects/:id', (req) =>
    store.updateProject(IdParams.parse(req.params).id, UpdateProject.parse(req.body)),
  );
  app.delete('/projects/:id', async (req, reply) => {
    await store.deleteProject(IdParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post('/threads', async (req, reply) => {
    reply.code(201);
    return store.createThread(CreateThread.parse(req.body));
  });
  app.patch('/threads/:id', (req) => store.updateThread(IdParams.parse(req.params).id, UpdateThread.parse(req.body)));
  app.delete('/threads/:id', async (req, reply) => {
    await store.deleteThread(IdParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.patch('/settings', (req) => store.updateSettings(UpdateSettings.parse(req.body)));
}
