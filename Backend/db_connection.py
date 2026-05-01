from shared.db.connection import get_db_connection


def fetch_course_offerings_page(limit=50, offset=0):
    query = """
        SELECT
            id,
            curr_id,
            code,
            course_no,
            section,
            descriptive_title,
            units,
            mth_schedule,
            mth_room_id,
            tfs_schedule,
            tfs_room_id
        FROM public.course_offerings
        ORDER BY id ASC
        LIMIT %s OFFSET %s
    """
    count_query = "SELECT COUNT(*) FROM public.course_offerings"

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (limit, offset))
            rows = cur.fetchall()
            cur.execute(count_query)
            total = cur.fetchone()[0]
    return rows, total

