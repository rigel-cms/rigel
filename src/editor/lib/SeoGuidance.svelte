<script lang="ts">
  let { field, value }: { field: string; value: unknown } = $props();
  const limits = $derived(field === "metaTitle" ? { min: 50, max: 60, label: "SEO title" } : { min: 120, max: 160, label: "SEO description" });
  const count = $derived(typeof value === "string" ? [...value].length : 0);
  const status = $derived(!count ? "Not set" : count < limits.min ? "Too short" : count > limits.max ? "Too long" : "Recommended length");
  const tone = $derived(!count ? "empty" : count > limits.max || count < limits.min / 2 ? "danger" : count < limits.min ? "warning" : "success");
</script>

{#if field === "metaTitle" || field === "description"}
  <div class="seo-length" data-seo-length={field} data-tone={tone}>
    <div class="seo-length-track" role="meter" aria-label={`${limits.label} length`} aria-valuemin={0} aria-valuemax={Math.max(limits.max, count)} aria-valuenow={count} aria-valuetext={`${count} characters. ${status}. Recommended ${limits.min} to ${limits.max}.`} title={status}>
      <span class="seo-length-fill" style:width={`${Math.min(count / limits.max * 100, 100)}%`}></span>
    </div>
    <div class="seo-length-summary hint">
      <span>Recommended: {limits.min}–{limits.max} characters.</span>
      <span class="seo-length-count" aria-hidden="true">{count}/{limits.max}</span>
    </div>
  </div>
{:else if field === "ogImage"}
  <p class="hint">Recommended size: 1200 × 628 px.</p>
{/if}
