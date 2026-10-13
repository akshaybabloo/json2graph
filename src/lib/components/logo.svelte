<script lang="ts">
	let { class: className }: { class?: string } = $props();
</script>

<!--
	The json2graph mark: curly braces around a brace that forks from one node
	to two. It is too fine for a favicon, which shows the fork alone (see
	`src/lib/assets/favicon.svg`).
-->
<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 48 48"
	fill="none"
	stroke="currentColor"
	stroke-width="3"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class={className}
>
	<path
		d="M9.5 5c-2.7 0-4 1.3-4 4v9.5c0 3-1.2 5.5-3.5 5.5 2.3 0 3.5 2.5 3.5 5.5V39c0 2.7 1.3 4 4 4"
	/>
	<path
		d="M38.5 5c2.7 0 4 1.3 4 4v9.5c0 3 1.2 5.5 3.5 5.5-2.3 0-3.5 2.5-3.5 5.5V39c0 2.7-1.3 4-4 4"
	/>
	<path
		d="M28 14h-1.5c-2.2 0-3.2 1-3.2 3.2v3.3c0 2-1.1 3.5-3.3 3.5 2.2 0 3.3 1.5 3.3 3.5v3.3c0 2.2 1 3.2 3.2 3.2H28"
	/>
	<g fill="var(--brand)" stroke="none">
		<rect x="10.5" y="20" width="8" height="8" rx="2.4" />
		<rect x="28.5" y="10" width="8" height="8" rx="2.4" />
		<rect x="28.5" y="30" width="8" height="8" rx="2.4" />
	</g>
</svg>
