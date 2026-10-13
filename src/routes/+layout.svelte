<script lang="ts">
	import './layout.css';
	import { asset } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import { SITE } from '#lib/site.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// What the site is, for search engines. `<` is escaped so that no text can
	// end the script element it is written into.
	const structured = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: SITE.name,
		description: SITE.description,
		url: SITE.url || undefined,
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Any',
		isAccessibleForFree: true
	}).replace(/</g, '\\u003c');
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={asset('apple-touch-icon.png')} />
	<link rel="manifest" href={asset('manifest.webmanifest')} />
	<meta name="description" content={SITE.description} />
	<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE.name} />
	<meta property="og:title" content={SITE.title} />
	<meta property="og:description" content={SITE.description} />
	{#if SITE.url}
		<!-- These need the address the site is published at. -->
		<link rel="canonical" href="{SITE.url}/" />
		<meta property="og:url" content="{SITE.url}/" />
		<meta property="og:image" content="{SITE.url}/og.png" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:alt" content="The json2graph logo: {SITE.description}" />
		<meta name="twitter:card" content="summary_large_image" />
	{:else}
		<meta name="twitter:card" content="summary" />
	{/if}

	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant of this file, with `<` escaped -->
	{@html `<script type="application/ld+json">${structured}</` + 'script>'}
</svelte:head>

{@render children()}
