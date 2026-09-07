import { AlbumService, TrackService } from '$lib/db/queries';
import { ArtistPublicContentService, PostPollService } from '$lib/db/services/ContentService';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { artist, viewer, isSubscriber } = await parent();

	const userId = locals.user?.id;
	const albumsPromise = AlbumService.getAlbumsByArtist(artist.id);
	const tracksQueryPromise = TrackService.getTracksByArtist({
		artistId: artist.id,
		userId,
		limit: 1000
	});

	// Streamed: derive the per-track `locked` flag from the already-firing query + resolved flag.
	const tracksPromise = tracksQueryPromise.then((tracks) =>
		tracks.map((entry) => ({
			...entry,
			locked: !isSubscriber && entry.track.visibility === 'subscribers'
		}))
	);

	// Streamed: content aggregation (the heavy query) starts right after the flag resolves.
	const contentPromise = ArtistPublicContentService.getArtistContent(artist.id, {
		userId,
		isOwner: viewer.isOwner,
		isSubscriber
	});

	return {
		artist,
		viewer,
		// Streamed (un-awaited) — the template renders these with {#await} + skeletons.
		tracks: tracksPromise,
		albums: albumsPromise,
		content: contentPromise
	};
};

function getString(data: FormData, key: string) {
	const value = data.get(key);
	return typeof value === 'string' ? value.trim() : '';
}

export const actions: Actions = {
	votePoll: async ({ request, locals }) => {
		if (!locals.user?.id) {
			return fail(401, { error: 'Sign in to vote' });
		}

		const data = await request.formData();
		const pollId = getString(data, 'pollId');
		const optionId = getString(data, 'optionId');

		if (!pollId || !optionId) {
			return fail(400, { error: 'Invalid poll vote' });
		}

		const result = await PostPollService.vote({
			pollId,
			optionId,
			userId: locals.user.id
		});

		if (!result.ok) {
			return fail(400, { error: result.reason });
		}

		return { success: true };
	}
};
