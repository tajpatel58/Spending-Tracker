from ollama import chat

MODEL = "qwen3:8b"

# Raise context window for OLLAMA
NUM_CTX = 16384
CONTEXT_HEADROOM = 256


def ollama_chat(prompt: str, schema: dict | None = None):
    llm_kwargs = dict()
    if schema is not None:
        llm_kwargs["format"] = schema

    response = chat(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        think=False,
        options={"num_ctx": NUM_CTX},
        **llm_kwargs
    )

    # Ollama truncates without warning, so fail loudly before that can happen again
    if response.prompt_eval_count and response.prompt_eval_count >= NUM_CTX - CONTEXT_HEADROOM:
        raise ValueError(
            f"Prompt used {response.prompt_eval_count} of {NUM_CTX} context tokens; "
            "raise NUM_CTX so the start of the prompt isn't cut off."
        )

    return response