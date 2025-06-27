import express from 'express';
import type { Request, Response } from 'express';
import { OxyServices } from '../core';

export interface CreateAuthOptions {
  baseURL: string;
}

export function createAuth(options: CreateAuthOptions) {
  const oxy = new OxyServices({ baseURL: options.baseURL });
  const router = express.Router();

  // Helper to handle async route functions
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => async (
    req: Request,
    res: Response
  ) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      res.status(err?.status || 500).json({ message: err?.message || 'Server error' });
    }
  };

  router.post(
    '/signup',
    wrap(async (req, res) => {
      const { username, email, password } = req.body;
      const result = await oxy.signUp(username, email, password);
      res.json(result);
    })
  );

  router.post(
    '/login',
    wrap(async (req, res) => {
      const { username, password } = req.body;
      const result = await oxy.login(username, password);
      res.json(result);
    })
  );

  router.post(
    '/logout',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1];
      const refreshToken = req.body.refreshToken;
      if (token) oxy.setTokens(token, refreshToken);
      await oxy.logout();
      res.json({ success: true });
    })
  );

  router.post(
    '/refresh',
    wrap(async (req, res) => {
      const refreshToken = req.body.refreshToken;
      const accessToken = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(accessToken, refreshToken);
      const tokens = await oxy.refreshTokens();
      res.json(tokens);
    })
  );

  router.get(
    '/validate',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(token, '');
      const valid = await oxy.validate();
      res.json({ valid });
    })
  );

  router.get(
    '/sessions',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(token, '');
      const sessions = await oxy.getUserSessions();
      res.json(sessions);
    })
  );

  router.delete(
    '/sessions/:id',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(token, '');
      const result = await oxy.logoutSession(req.params.id);
      res.json(result);
    })
  );

  router.post(
    '/sessions/logout-others',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(token, '');
      const result = await oxy.logoutOtherSessions();
      res.json(result);
    })
  );

  router.post(
    '/sessions/logout-all',
    wrap(async (req, res) => {
      const token = req.headers.authorization?.split(' ')[1] || '';
      oxy.setTokens(token, '');
      const result = await oxy.logoutAllSessions();
      res.json(result);
    })
  );

  return { middleware: router };
}
