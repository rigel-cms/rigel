<script lang="ts">
  import { t } from "../i18n";
  let { field, value }: { field: string; value: unknown } = $props();
  const limits = $derived(field === "metaTitle" ? { min: 50, max: 60 } : { min: 120, max: 160 });
  const count = $derived(typeof value === "string" ? [...value].length : 0);
  const status = $derived($t(!count ? "fields.seoNotSet" : count < limits.min ? "fields.seoTooShort" : count > limits.max ? "fields.seoTooLong" : "fields.seoRecommendedLength"));
  const tone = $derived(!count ? "empty" : count > limits.max || count < limits.min / 2 ? "danger" : count < limits.min ? "warning" : "success");
</script>

{#if field === "metaTitle" || field === "description"}
  <div class="seo-length" data-seo-length={field} data-tone={tone}>
    <div class="seo-length-track" role="meter" aria-label={$t(field === "metaTitle" ? "fields.seoTitleLength" : "fields.seoDescriptionLength")} aria-valuemin={0} aria-valuemax={Math.max(limits.max, count)} aria-valuenow={count} aria-valuetext={$t("fields.seoLengthDetails", { count, status, min: limits.min, max: limits.max })} data-tooltip={status}>
      <span class="seo-length-fill" style:width={`${Math.min(count / limits.max * 100, 100)}%`}></span>
    </div>
    <div class="seo-length-summary hint">
      <span>{$t("fields.seoRecommendedCharacters", { min: limits.min, max: limits.max })}</span>
      <span class="seo-length-count" aria-hidden="true">{count}/{limits.max}</span>
    </div>
  </div>
{:else if field === "ogImage"}
  <p class="hint">{$t("fields.seoRecommendedImageSize")}</p>
{/if}
