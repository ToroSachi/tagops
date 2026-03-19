# VHS documentation: https://github.com/charmbracelet/vhs
#
# To run this tape and generate your GIF demo for the README:
# 1. Install VHS: `brew install vhs`
# 2. Run: `vhs demo.tape`
#
# It will generate `demo.gif` in the current directory.

Output demo.gif

# Set up the terminal window for an aesthetic output
Set FontSize 16
Set FontFamily "JetBrains Mono"
Set Width 1200
Set Height 800
Set Padding 30
Set Theme "Catppuccin Mocha"

# Fake the prompt for visually clean output
Hide
Type "export PS1='\e[32;1m$\e[0m '"
Enter
Type "clear"
Enter
Show

# Wait a beat before starting
Sleep 1s

# Command 1: Show the auditing powers
Type "tagops audit"
Sleep 1s
Enter

# Wait for audit output to scroll
Sleep 6s

# Clear and show other commands
Type "clear"
Enter
Sleep 1s

# Command 2: Show health scoring
Type "tagops health-score"
Sleep 1s
Enter
Sleep 4s

Type "clear"
Enter
Sleep 1s

# Command 3: Show consent mode auditing (very unique feature)
Type "tagops consent-audit"
Sleep 1s
Enter
Sleep 5s

# End of Demo
Sleep 2s
