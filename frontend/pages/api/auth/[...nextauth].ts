import NextAuth, { type NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.BACKEND_API_URL || 'http://api:8000';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';

type CommentAuthSettings = {
  github_client_id?: string;
  github_client_secret?: string;
  google_client_id?: string;
  google_client_secret?: string;
  nextauth_secret?: string;
};

async function getCommentAuthSettings(): Promise<CommentAuthSettings> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/settings/comments`, {
      headers: INTERNAL_API_TOKEN
        ? {
            'X-Internal-Token': INTERNAL_API_TOKEN,
          }
        : undefined,
    });
  } catch (error) {
    throw new Error('无法连接后端评论配置接口');
  }

  if (!response.ok) {
    throw new Error(`评论配置接口请求失败: ${response.status}`);
  }

  return response.json();
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const settings = await getCommentAuthSettings();
  const providers = [];

  if (settings.github_client_id && settings.github_client_secret) {
    providers.push(
      GithubProvider({
        clientId: settings.github_client_id,
        clientSecret: settings.github_client_secret,
      }),
    );
  }

  if (settings.google_client_id && settings.google_client_secret) {
    providers.push(
      GoogleProvider({
        clientId: settings.google_client_id,
        clientSecret: settings.google_client_secret,
      }),
    );
  }

  if (providers.length === 0) {
    providers.push(
      CredentialsProvider({
        name: 'disabled',
        credentials: {},
        async authorize() {
          return null;
        },
      }),
    );
  }

  return {
    providers,
    session: {
      strategy: 'jwt',
    },
    callbacks: {
      async jwt({ token, account }) {
        if (account?.provider) {
          token.provider = account.provider;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.sub || '';
          session.user.provider = (token.provider as string) || '';
        }
        return session;
      },
    },
    secret: settings.nextauth_secret,
  };
}

export default async function auth(req: any, res: any) {
  try {
    const authOptions = await getAuthOptions();
    return NextAuth(req, res, authOptions);
  } catch (error) {
    return res.status(503).json({ error: '评论登录配置不可用，请检查后端设置' });
  }
}
