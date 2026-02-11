import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';

import { getAuthOptions } from '../../auth/[...nextauth]';

const API_URL = process.env.BACKEND_API_URL || 'http://api:8000';
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

async function fetchComment(commentId: string) {
  const response = await fetch(`${API_URL}/api/comments/${commentId}`);
  const data = await response.json();
  return { response, data };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    res.status(400).json({ message: '缺少评论ID' });
    return;
  }

  const session = await getServerSession(req, res, await getAuthOptions());
  if (!session?.user?.id) {
    res.status(401).json({ message: '请先登录' });
    return;
  }

  if (req.method === 'GET') {
    const enabled = await commentsEnabled();
    if (!enabled) {
      res.status(200).json(null);
      return;
    }
    try {
      const { response, data } = await fetchComment(id);
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: '获取评论失败' });
    }
    return;
  }

  if (req.method === 'PUT') {
    if (!INTERNAL_API_TOKEN) {
      res.status(500).json({ message: '服务端缺少 INTERNAL_API_TOKEN 配置' });
      return;
    }
    const enabled = await commentsEnabled();
    if (!enabled) {
      res.status(403).json({ message: '评论已关闭' });
      return;
    }
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      res.status(400).json({ message: '评论内容不能为空' });
      return;
    }
    if (content.length > 1000) {
      res.status(400).json({ message: '评论内容过长' });
      return;
    }
    try {
      const { response: fetchResponse, data: comment } = await fetchComment(id);
      if (!fetchResponse.ok) {
        res.status(fetchResponse.status).json(comment);
        return;
      }
      if (comment.user_id !== session.user.id) {
        res.status(403).json({ message: '无权限操作该评论' });
        return;
      }
      const response = await fetch(`${API_URL}/api/comments/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': INTERNAL_API_TOKEN,
        },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: '更新评论失败' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    if (!INTERNAL_API_TOKEN) {
      res.status(500).json({ message: '服务端缺少 INTERNAL_API_TOKEN 配置' });
      return;
    }
    const enabled = await commentsEnabled();
    if (!enabled) {
      res.status(403).json({ message: '评论已关闭' });
      return;
    }
    try {
      const { response: fetchResponse, data: comment } = await fetchComment(id);
      if (!fetchResponse.ok) {
        res.status(fetchResponse.status).json(comment);
        return;
      }
      if (comment.user_id !== session.user.id) {
        res.status(403).json({ message: '无权限操作该评论' });
        return;
      }
      const response = await fetch(`${API_URL}/api/comments/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Internal-Token': INTERNAL_API_TOKEN,
        },
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({ message: '删除评论失败' });
    }
    return;
  }

  res.status(405).json({ message: 'Method Not Allowed' });
}
