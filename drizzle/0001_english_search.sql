-- English stemming next to 'simple' and 'turkish' (docs/designs/izgah-i18n-oss.md §5).
-- Expand-only: the triggers gain an extra dictionary and existing rows are backfilled;
-- release N-1 keeps working because it only queries the 'simple' and 'turkish' lexemes.
CREATE OR REPLACE FUNCTION "public"."canonical_resources_search_vector_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	url_tokens text;
BEGIN
	url_tokens := regexp_replace(coalesce(NEW.canonical_url, ''), '[^[:alnum:]]+', ' ', 'g');
	NEW.search_vector :=
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.title, ''))), 'A') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.domain, '') || ' ' || coalesce(NEW.canonical_url, '') || ' ' || url_tokens)), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.title, ''))), 'B') ||
		setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'B') ||
		setweight(to_tsvector('turkish', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('english', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C') ||
		setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, '') || ' ' || coalesce(NEW.site_name, ''))), 'C');
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."link_shares_note_search_vector_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.deleted_at IS NOT NULL OR NEW.note IS NULL OR btrim(NEW.note) = '' THEN
		NEW.note_search_vector := ''::tsvector;
	ELSE
		NEW.note_search_vector :=
			setweight(to_tsvector('simple', unaccent(NEW.note)), 'B') ||
			setweight(to_tsvector('turkish', unaccent(NEW.note)), 'B') ||
			setweight(to_tsvector('english', unaccent(NEW.note)), 'B');
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
-- Backfill: touching a column listed in each trigger's UPDATE OF list re-runs the function.
UPDATE "public"."canonical_resources" SET "title" = "title";--> statement-breakpoint
UPDATE "public"."link_shares" SET "note" = "note" WHERE "note" IS NOT NULL;
