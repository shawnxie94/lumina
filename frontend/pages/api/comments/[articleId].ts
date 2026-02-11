import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';

import { getAuthOptions } from '../auth/[...nextauth]';

const API_URL = process.env.BACKEND_API_URL || 'http://api:8000/backend';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';
const SETTINGS_URL = `${API_URL}/api/settings/comments/public`;

async function commentsEnabled(): Promise<boolean> {
  try {
    const response = await fetch(SETTINGS_URL);
    if (!response.ok) return true;
    const data = await response.json();
    return Boolean(data.comments_enabled);
  } catch (error) {
    return true;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { articleId } = req.query;
  if (!articleId || typeof articleId !== 'string') {
    res.status(400).json({ message: '缺少文章ID' });
    return;
  }

  if (req.method === 'GET') {
    const enabled = await commentsEnabled();
    if (!enabled) {
      res.status(200).json([]);
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/articles/${articleId}/comments`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: '获取评论失败' });
    }
    return;
  }

  if (req.method === 'POST') {
    const enabled = await commentsEnabled();
    if (!enabled) {
      res.status(403).json({ message: '评论已关闭' });
      return;
    }
    if (!INTERNAL_API_TOKEN) {
      res.status(500).json({ message: '服务端缺少 INTERNAL_API_TOKEN 配置' });
      return;
    }
    const session = await getServerSession(req, res, await getAuthOptions());
    if (!session?.user?.id) {
      res.status(401).json({ message: '请先登录' });
      return;
    }
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const replyToId = typeof req.body?.reply_to_id === 'string' ? req.body.reply_to_id : '';
    if (!content.trim()) {
      res.status(400).json({ message: '评论内容不能为空' });
      return;
    }
    if (content.length > 1000) {
      res.status(400).json({ message: '评论内容过长' });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': INTERNAL_API_TOKEN,
        },
        body: JSON.stringify({
          content,
          reply_to_id: replyToId || null,
          user_id: session.user.id,
          user_name: session.user.name || '访客',
          user_avatar: session.user.image || '',
          provider: session.user.provider || '',
        }),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: '发布评论失败' });
    }
    return;
  }

  res.status(405).json({ message: 'Method Not Allowed' });
}
