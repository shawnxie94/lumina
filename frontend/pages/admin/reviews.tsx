import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
	redirect: {
		destination: "/admin/settings/ai/review-templates",
		permanent: false,
	},
});

export default function AdminReviewsRedirectPage() {
	return null;
}
