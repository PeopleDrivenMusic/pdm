import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/db/queries', () => ({
	ArtistService: { getArtistBySlug: vi.fn() }
}));

vi.mock('$lib/server/entitlement', () => ({
	EntitlementService: { isSubscriberOf: vi.fn() }
}));

import { ArtistService } from '$lib/db/queries';
import { EntitlementService } from '$lib/server/entitlement';
import { load } from './+layout.server';

const artist = (overrides: Partial<{ id: string; userId: string; slug: string }> = {}) => ({
	id: 'artist-1',
	userId: 'owner-1',
	slug: 'artist-1',
	...overrides
});

const evt = (user: any) => ({
	params: { slug: 'artist-1' },
	locals: { user }
});

beforeEach(() => vi.clearAllMocks());

it('throws 404 when ArtistService.getArtistBySlug resolves null', async () => {
	(ArtistService.getArtistBySlug as any).mockResolvedValue(undefined);

	await expect((load as any)(evt(null))).rejects.toMatchObject({ status: 404 });
	expect(EntitlementService.isSubscriberOf).not.toHaveBeenCalled();
});

it('marks the artist owner as isOwner without calling EntitlementService', async () => {
	(ArtistService.getArtistBySlug as any).mockResolvedValue(artist({ userId: 'owner-1' }));

	const result = await (load as any)(evt({ id: 'owner-1' }));

	expect(result.viewer.isOwner).toBe(true);
	expect(result.viewer.isSubscribed).toBe(false);
	expect(result.viewer.canSubscribe).toBe(false);
	expect(result.isSubscriber).toBe(true);
	expect(EntitlementService.isSubscriberOf).not.toHaveBeenCalled();
});

it('marks a logged-in non-owner subscriber as isSubscribed', async () => {
	(ArtistService.getArtistBySlug as any).mockResolvedValue(artist({ userId: 'owner-1' }));
	(EntitlementService.isSubscriberOf as any).mockResolvedValue(true);

	const result = await (load as any)(evt({ id: 'fan-1' }));

	expect(EntitlementService.isSubscriberOf).toHaveBeenCalledWith('fan-1', 'artist-1');
	expect(result.viewer.isOwner).toBe(false);
	expect(result.viewer.isSubscribed).toBe(true);
	expect(result.viewer.canSubscribe).toBe(false);
	expect(result.isSubscriber).toBe(true);
});

it('allows a logged-in non-owner non-subscriber to subscribe', async () => {
	(ArtistService.getArtistBySlug as any).mockResolvedValue(artist({ userId: 'owner-1' }));
	(EntitlementService.isSubscriberOf as any).mockResolvedValue(false);

	const result = await (load as any)(evt({ id: 'fan-1' }));

	expect(EntitlementService.isSubscriberOf).toHaveBeenCalledWith('fan-1', 'artist-1');
	expect(result.viewer.canSubscribe).toBe(true);
	expect(result.viewer.isSubscribed).toBe(false);
	expect(result.isSubscriber).toBe(false);
});
