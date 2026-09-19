import type {
	Dispatch,
	MouseEvent,
	RefObject,
	SetStateAction,
} from "react";

import type { Session } from "next-auth";
import { signIn, signOut } from "next-auth/react";
import type { NextRouter } from "next/router";

import IconButton from "@/components/IconButton";
import CommentSection, {
	collectCommentDescendantIds,
} from "@/components/comment/CommentSection";
import {
	IconArrowDown,
	IconBook,
	IconDoc,
	IconEdit,
	IconEye,
	IconEyeOff,
	IconTrash,
} from "@/components/icons";
import type { ReviewComment, ReviewIssue } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface CommentProviders {
	github: boolean;
	google: boolean;
}

interface ColumnDetailArticleProps {
	review: ReviewIssue;
	immersiveMode: boolean;
	setImmersiveMode: Dispatch<SetStateAction<boolean>>;
	isAdmin: boolean;
	router: NextRouter;
	currentTopImageUrl: string;
	contentRef: RefObject<HTMLDivElement>;
	handleContentClick: (event: MouseEvent<HTMLDivElement>) => void;
	html: string;
	handleExportMarkdown: () => void;
	openEditMode: () => void;
	handlePublishToggle: () => Promise<void>;
	publishing: boolean;
	setShowDeleteIssueModal: Dispatch<SetStateAction<boolean>>;
	commentsEnabled: boolean;
	comments: ReviewComment[];
	session: Session | null;
	commentsLoading: boolean;
	displayCommentCount: number;
	commentProviders: CommentProviders;
	handleSubmitComment: (
		content: string,
		replyToId?: string | null,
	) => Promise<ReviewComment | undefined>;
	handleUpdateComment: (commentId: string, content: string) => Promise<void>;
	handleDeleteComment: (commentId: string) => Promise<void>;
	handleToggleCommentHidden: (
		commentId: string,
		isHidden: boolean,
	) => Promise<void>;
}

function ColumnDetailArticle({
	review,
	immersiveMode,
	setImmersiveMode,
	isAdmin,
	router,
	currentTopImageUrl,
	contentRef,
	handleContentClick,
	html,
	handleExportMarkdown,
	openEditMode,
	handlePublishToggle,
	publishing,
	setShowDeleteIssueModal,
	commentsEnabled,
	comments,
	session,
	commentsLoading,
	displayCommentCount,
	commentProviders,
	handleSubmitComment,
	handleUpdateComment,
	handleDeleteComment,
	handleToggleCommentHidden,
}: ColumnDetailArticleProps) {
	const { t } = useI18n();

	return (
		<article
			className={`flex-1 min-w-0 w-full bg-surface ${
				immersiveMode
					? ""
					: "mx-auto max-w-4xl rounded-sm border border-border p-4 shadow-sm sm:p-6 lg:mx-0"
			}`}
		>
			{!immersiveMode ? (
				<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="inline-flex items-center gap-2 text-lg font-semibold text-text-1">
							<IconDoc className="h-4 w-4" />
							<span>{t("内容")}</span>
						</h2>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<IconButton
							onClick={handleExportMarkdown}
							variant="ghost"
							size="md"
							title={t("导出 Markdown")}
							className="rounded-sm"
						>
							<IconArrowDown className="h-4 w-4" />
						</IconButton>
						{isAdmin ? (
							<>
								<IconButton
									onClick={openEditMode}
									variant="ghost"
									size="md"
									title={t("编辑专栏文章")}
									className="rounded-sm"
								>
									<IconEdit className="h-4 w-4" />
								</IconButton>
								<IconButton
									onClick={handlePublishToggle}
									variant="ghost"
									size="md"
									title={
										review.status === "published"
											? t("返回草稿")
											: t("发布专栏文章")
									}
									loading={publishing}
									disabled={publishing}
									className="rounded-sm"
								>
									{review.status === "published" ? (
										<IconEyeOff className="h-4 w-4" />
									) : (
										<IconEye className="h-4 w-4" />
									)}
								</IconButton>
								<IconButton
									onClick={() => setShowDeleteIssueModal(true)}
									variant="danger"
									size="md"
									title={t("删除专栏文章")}
									className="rounded-sm"
								>
									<IconTrash className="h-4 w-4" />
								</IconButton>
							</>
						) : null}
						<button
							type="button"
							onClick={() => setImmersiveMode(true)}
							className="flex h-8 w-8 items-center justify-center rounded-sm text-text-2 transition hover:bg-muted hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
							title={t("进入沉浸模式")}
							aria-label={t("进入沉浸模式")}
						>
							<IconBook className="h-4 w-4" />
						</button>
					</div>
				</div>
			) : null}

			{currentTopImageUrl ? (
				<div className="mb-6 overflow-hidden rounded-sm border border-border bg-muted">
					<img
						src={currentTopImageUrl}
						alt={review.title}
						className="aspect-video w-full object-cover"
					/>
				</div>
			) : null}

			<div
				ref={contentRef}
				onClick={handleContentClick}
				className={`article-prose prose prose-sm max-w-none break-words overflow-x-auto prose-img:cursor-zoom-in prose-img:rounded-lg prose-img:border prose-img:border-border prose-img:bg-surface prose-img:shadow-sm ${
					immersiveMode
						? "immersive-content"
						: "prose-img:max-w-full lg:prose-img:max-w-[420px]"
				}`}
				dangerouslySetInnerHTML={{ __html: html }}
			/>

			{!immersiveMode && review.status === "published" ? (
				<div className="mt-6 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
					<button
						type="button"
						onClick={() =>
							review.prev_review &&
							router.push(`/columns/${review.prev_review.slug}`)
						}
						disabled={!review.prev_review}
						className={`rounded-lg px-3 py-2 text-left transition ${
							review.prev_review
								? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
								: "cursor-not-allowed bg-muted text-text-3"
						}`}
						title={review.prev_review?.title || t("无上一篇")}
					>
						<span className="block">← {t("上一篇")}</span>
						{review.prev_review ? (
							<span className="block text-xs text-text-3">
								{(review.prev_review?.title || "").length > 24
									? `${(review.prev_review?.title || "").slice(0, 24)}...`
									: review.prev_review?.title || ""}
							</span>
						) : null}
					</button>
					<button
						type="button"
						onClick={() =>
							review.next_review &&
							router.push(`/columns/${review.next_review.slug}`)
						}
						disabled={!review.next_review}
						className={`rounded-lg px-3 py-2 text-right transition ${
							review.next_review
								? "bg-muted text-text-2 hover:bg-surface hover:text-text-1"
								: "cursor-not-allowed bg-muted text-text-3"
						}`}
						title={review.next_review?.title || t("无下一篇")}
					>
						<span className="block">{t("下一篇")} →</span>
						{review.next_review ? (
							<span className="block text-xs text-text-3">
								{(review.next_review?.title || "").length > 24
									? `${(review.next_review?.title || "").slice(0, 24)}...`
									: review.next_review?.title || ""}
							</span>
						) : null}
					</button>
				</div>
			) : null}

			{!immersiveMode &&
			review.status === "published" &&
			commentsEnabled ? (
				<section className="mt-10">
				<div className="bg-surface border border-border rounded-sm p-5">
					<CommentSection
						comments={comments}
						session={session}
						isAdmin={isAdmin}
						onSubmitComment={handleSubmitComment}
						onUpdateComment={handleUpdateComment}
						onDeleteComment={handleDeleteComment}
						onToggleHidden={isAdmin ? handleToggleCommentHidden : undefined}
						loading={commentsLoading}
						displayCommentCount={displayCommentCount}
						commentProviders={commentProviders}
						onSignIn={(provider) => {
							void signIn(provider);
						}}
						onSignOut={() => {
							void signOut();
						}}
					/>
				</div>
			</section>
			) : null}
		</article>
	);
}

export default ColumnDetailArticle;
