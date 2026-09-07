import { ArtistService } from '$lib/db/queries';
import { EntitlementService } from '$lib/server/entitlement';
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const artist = await ArtistService.getArtistBySlug(params.slug);
	if (!artist) {
		throw error(404, 'Artist not found');
	}

	const userId = locals.user?.id;
	const isOwner = userId === artist.userId;

	// Fail closed if the entitlement lookup errors: treat the viewer as a non-subscriber
	// (content stays locked) rather than throwing.
	let isSubscriber: boolean;
	try {
		isSubscriber = isOwner ? true : await EntitlementService.isSubscriberOf(userId, artist.id);
	} catch {
		isSubscriber = false;
	}

	return {
		artist,
		viewer: {
			isOwner,
			isSubscribed: !isOwner && isSubscriber,
			canSubscribe: Boolean(userId) && !isOwner && !isSubscriber,
			isLoggedIn: Boolean(userId)
		},
		isSubscriber
	};
};
