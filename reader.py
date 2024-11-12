# reader.py
import typer
import llm
import ebooklib
from ebooklib import epub
import html2text
from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown
from rich.table import Table
from readchar import readkey
from pathlib import Path
from tts import text_to_speech_stream
from elevenlabs import play

app = typer.Typer()
console = Console()

class Reader:
    def __init__(self, epub_path: str):
        self.book = epub.read_epub(epub_path)
        self.model = llm.get_model("gpt-4o-mini")
        self.sections = self._process_sections()
        self.current_index = self.current_page = 0
        self.pages = []
        self.metadata = self._extract_metadata()


    def _extract_metadata(self):
        return {
            key: self.book.get_metadata('DC', key)
            for key in ['title', 'author', 'language', 'description']
        }
    
    def _process_sections(self):
        # convert epub sections to text
        html2tui = html2text.HTML2Text()
        html2tui.ignore_links = html2tui.ignore_images = True
        sections, prev = [], None

        for item in self.book.get_items():
            if item.get_type() != ebooklib.ITEM_DOCUMENT:
                continue
                
            try:
                if content := item.get_content():
                    content = html2tui.handle(content.decode('utf-8'))
                section = {
                    'content': content,
                    'title': self._extract_title(item, content),
                    'parent': prev['title'] if prev else None,
                }
                sections.append(section)
                prev = section
            except Exception as e:
                console.print(f"[yellow]Warning: Couldn't process section: {e}[/yellow]")
        
        return sections
    
    def _extract_title(self, item, content):
        # try to get title from item
        if hasattr(item, 'title') and item.title:
            return item.title
            
        # check first 5 lines for markdown heading
        lines = content.strip().split('\n')
        for line in lines[:5]:  # Check first 5 lines
            if line.startswith('#'):  # Markdown heading
                return line.lstrip('#').strip()
                
        # fallback to filename
        return Path(item.file_name).stem.replace('_', ' ').strip()
    
    def display_current(self):
        # show current section with progress indicators
        if not self.sections:
            console.print("[red]No content available[/red]")
            return

        section = self.sections[self.current_index]
        content = section['content']
        
        console_height = console.height - 10
        
        # split content into paragraphs and group them into pages
        paragraphs = content.split('\n\n')
        self.pages = []
        current_page = []
        current_lines = 0
        
        for para in paragraphs:
            # Estimate lines this paragraph will take (including word wrap)
            para_lines = len(para) // (console.width - 10) + para.count('\n') + 2
            
            if current_lines + para_lines > console_height:
                if current_page:  # Save current page if not empty
                    self.pages.append('\n\n'.join(current_page))
                    current_page = [para]
                    current_lines = para_lines
                else:  # If a single paragraph is longer than page height, force split it
                    self.pages.append(para)
                    current_page = []
                    current_lines = 0
            else:
                current_page.append(para)
                current_lines += para_lines
        
        # Add the last page if there's content
        if current_page:
            self.pages.append('\n\n'.join(current_page))
        
        # ensure we have at least one page
        if not self.pages:
            self.pages = ['[No content]']
        
        # safety check: ensure current_page is within bounds
        if self.current_page >= len(self.pages):
            self.current_page = len(self.pages) - 1
        elif self.current_page < 0:
            self.current_page = 0
        
        page_content = self.pages[self.current_page]
        
        # calculate progress
        overall_progress = (self.current_index / len(self.sections)) * 100
        section_progress = (self.current_page / len(self.pages)) * 100
        
        # render ui
        console.clear()
        header = Table.grid(padding=1, expand=True)
        header.add_column("title", justify="left", ratio=2)
        header.add_column("progress", justify="right", ratio=1)
        header.add_row(
            f"[bold blue]{section['title']}[/]",
            f"[yellow]Section {self.current_index + 1}/{len(self.sections)} "
            f"• Page {self.current_page + 1}/{len(self.pages)} ({section_progress:.1f}%) "
            f"• Overall {overall_progress:.1f}%[/]"
        )
        
        # display progress and content
        console.print(Panel(header))
        console.print(Panel(
            Markdown(page_content),
            border_style="blue"
        ))
        
        # show nav help
        nav_help = Table.grid(padding=1, expand=True)
        nav_help.add_column(style="dim")
        nav_help.add_row(
            "←(h) →(l) • ↑(k) ↓(j) • TOC(t) • Summarize(s) • Ask AI(a) • Read(r) • Guide(>) • Quit(q)"
            
        )
        console.print(Panel(nav_help))

    def show_toc(self):
        """Display table of contents."""
        sections_list = ""
        for i, section in enumerate(self.sections):
            marker = "→" if i == self.current_index else " "
            sections_list += f"{marker} {i+1}. {section['title']}\n"
        
        console.clear()
        console.print(Panel(
            sections_list,
            title="[blue]Table of Contents[/]",
            border_style="blue"
        ))
        console.input("\nPress Enter to continue...")

    def navigate(self, direction: int) -> bool:
        match direction:
            case -1 | 1:  # sections ←/→
                new_index = self.current_index + direction
                if 0 <= new_index < len(self.sections):
                    self.current_index, self.current_page = new_index, 0
                    return True
            case -2 | 2:  # pages ↑/↓
                new_page = self.current_page + (1 if direction == 2 else -1)
                if 0 <= new_page < len(self.pages):
                    self.current_page = new_page
                    return True
                # Try next/prev section
                new_index = self.current_index + (1 if direction == 2 else -1)
                if 0 <= new_index < len(self.sections):
                    self.current_index = new_index
                    self.current_page = 0 if direction == 2 else len(self.pages) - 1
                    return True
            case -99: self.current_index = self.current_page = 0; return True  # start
            case 99: self.current_index = len(self.sections)-1; self.current_page = len(self.pages)-1; return True  # end
        return False
    
    # ai 
    def _get_section_context(self):
        # get relevant context for ai from current position in book
        current = self.sections[self.current_index]
        current_content = self.pages[self.current_page]
        
        # get book metadata
        book_info = []
        if self.metadata.get('title'):
            book_info.append(f"Title: {self.metadata['title'][0][0]}")
        if self.metadata.get('author'):
            book_info.append(f"Author: {self.metadata['author'][0][0]}")
        
        # get hierarchical context
        hierarchy = []
        if current.get('parent'):
            hierarchy.append(f"Section: {current['parent']} > {current['title']}")
        else:
            hierarchy.append(f"Section: {current['title']}")

        context = f"""Book Information: {' | '.join(book_info)}

                Location: {' > '.join(hierarchy)}
                Page: {self.current_page + 1} of {len(self.pages)}

                Content:
                {current_content}"""

        return context

    def ask_ai(self):
        def calculate_layout():
            available_height = console.height - 12  # Extra space for question input
            content_height = available_height // 2
            response_height = available_height - content_height
            return content_height, response_height

        def render_split_view(content, response_text="", question=""):
            console.clear()
            content_height, response_height = calculate_layout()

            # Format the content to fit the panel
            content_lines = content.split('\n')
            visible_content = '\n'.join(content_lines[:content_height-4])  # Leave room for panel borders

            # Content panel - show as much as fits in the allocated height
            console.print(Panel(
                Markdown(visible_content),
                title="[blue]Current Text[/]",
                border_style="blue",
                height=content_height,
                expand=True
            ))

            # Response panel
            console.print(Panel(
                Markdown(response_text) if response_text else "[dim]Waiting for response...[/dim]",
                title=f"[green]AI Response{f' to: {question}' if question else ''}[/]",
                border_style="green",
                height=response_height,
                expand=True
            ))

        def stream_response(conversation, question, content):
            text = ""
            with console.status("[bold green]Thinking...[/]"):
                for chunk in conversation.prompt(f"Based on this text:\n{content}\n\nQuestion: {question}"):
                    text += chunk
                    render_split_view(content, text, question)
            return text

        conversation = self.model.conversation()
        conversation.system = "You are an expert reading assistant analyzing a book. Keep responses clear and concise."
        content = self._get_section_context()

        while True:
            render_split_view(content)
            
            question = console.input("\n[bold green]Question (:q to exit):[/] ").strip()
            while question:
                if question.lower() in (':q', ':quit'):
                    return
                    
                try:
                    stream_response(conversation, question, content)
                    question = console.input("\n[dim]Follow-up? (:q quit):[/] ").strip()
                except Exception as e:
                    console.print(f"[red]Error: {e}[/red]")
                    console.input("\nPress Enter to continue...")
                    return

    def summarize_current(self):
        if not self.pages:
            console.print("[red]No content to summarize[/red]")
            return

        def create_prompt(content):
            return f"""Please provide a concise summary of this text:
            {content}
            Focus on the key points and main ideas. Keep the summary brief and clear."""

        def calculate_layout():
            available_height = console.height - 8
            content_height = available_height // 2
            summary_height = available_height - content_height
            return content_height, summary_height

        def render_split_view(content, summary_text=""):
            console.clear()
            content_height, summary_height = calculate_layout()

            # Content panel
            console.print(Panel(
                Markdown(content),
                title="[blue]Current Text[/]",
                border_style="blue",
                height=content_height
            ))

            # Summary panel
            console.print(Panel(
                summary_text or "[dim]Generating summary...[/dim]",
                title="[green]Content Summary[/]",
                border_style="green",
                height=summary_height
            ))

        def stream_summary():
            current_content = self.pages[self.current_page]
            summary = ""
            
            with console.status("[bold green]Thinking...[/]"):
                response = self.model.prompt(create_prompt(current_content))
                for chunk in response:
                    summary += chunk
                    render_split_view(current_content, summary)
            
            return summary

        try:
            final_summary = stream_summary()
            console.input("\nPress Enter to continue...")
        except Exception as e:
            console.print(f"[red]Error generating summary: {e}[/red]")
            console.input("\nPress Enter to continue...")

    def read_aloud(self):
        """Read the current page aloud using text-to-speech."""
        if not self.pages:
            console.print("[red]No content to read[/red]")
            return

        try:
            content = self.pages[self.current_page]
            with console.status("[bold green]Converting text to speech...[/]"):
                audio = text_to_speech_stream(content)
            
            with console.status("[bold green]Reading aloud... (Press Ctrl+C to stop)[/]"):
                play(audio)
                
        except KeyboardInterrupt:
            console.print("\n[yellow]Stopped reading.[/yellow]")
        except Exception as e:
            console.print(f"[red]Error reading aloud: {e}[/red]")
        finally:
            console.input("\nPress Enter to continue...")

    def read_compass(self):
        """Generate and play an AI audio guide for current location."""
        try:
            prompt = f"""Provide a brief audio guide for the reader's current location:
            - Current story location
            - Scene context
            - Key characters/themes
            
            Keep it conversational, like an audiobook companion.
            
            Context:
            {self._get_section_context()}"""
            
            with console.status("[bold green]Creating guide...[/]"):
                response = "".join(chunk for chunk in self.model.prompt(prompt))
                
            with console.status("[bold green]Reading guide... (Ctrl+C to stop)[/]"):
                play(text_to_speech_stream(response))
                
        except KeyboardInterrupt:
            console.print("\n[yellow]Stopped reading.[/yellow]")
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
        finally:
            console.input("\nPress Enter to continue...")

@app.command()
def read(epub_path: str = typer.Argument(..., help="Path to EPUB file")):
    """Interactive ebook reader with AI assistance."""
    if not Path(epub_path).exists() or not epub_path.endswith('.epub'):
        console.print("[red]Please provide a valid EPUB file[/red]")
        raise typer.Exit(1)

    try:
        reader = Reader(epub_path)
        while True:
            reader.display_current()
            match readkey():
                case 'q': break
                case 'h' | '\x1b[D': reader.navigate(-1)  # h/← for prev section
                case 'l' | '\x1b[C': reader.navigate(1)   # l/→ for next section
                case 'j' | '\x1b[B': reader.navigate(2)   # j/↓ for next page
                case 'k' | '\x1b[A': reader.navigate(-2)  # k/↑ for prev page
                case 'g': reader.navigate(-99)  # g for start
                case 'G': reader.navigate(99)   # G for end
                case 'a': reader.ask_ai()
                case 's': reader.summarize_current()
                case 't': reader.show_toc()
                case 'r': reader.read_aloud()
                case '>': reader.read_compass()
    except KeyboardInterrupt:
        console.print("\n[yellow]Reader closed.[/yellow]")

if __name__ == "__main__":
    app()
