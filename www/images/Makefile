include ../../defines.mk

all:

# start.png /usr/share/icons/gnome/16x16/actions/media-playback-start.png
# stop.png /usr/share/icons/gnome/16x16/actions/media-playback-stop.png
# computer-template.png /usr/share/icons/gnome/16x16/mimetypes/gnome-mime-application-vnd.sun.xml.calc.template.png

# virt-viewer.png copied from virt-viewer sources
# tigervnc.png converted from tigervnc sources
# (tigervnc.org/media/tigervnc_16.svg)

# checked.png converted from extjs examples/ux/css/images/checked.gif
# unchecked.png converted from extjs examples/ux/css/images/unchecked.gif
# swap.png downloaded from https://www.iconfinder.com/icons/17009/arrows_exchange_interact_refresh_reload_swap_sync_update_icon#size=16

# icon-cd, icon-pci
# are self made (sources as .xcf)
# icon-swap, icon-display, icon-harddisk, icon-keyboard, icon-network, icon-usb, icon-cloud
# come from fontawesome (respective fa-refresh, fa-desktop, fa-hdd-o, fa-keyboard-o, fa-exchange, fa-usb, fa-ellipsis-h, fa-cloud)

# icon-serial is a modified version of
# https://commons.wikimedia.org/wiki/File:DE9_Diagram.svg
# (public domain)

# ceph logos are from
#  http://ceph.com/logos/

# xtermjs.png is a cropped version of the logo found on
# https://github.com/xtermjs/xterm.js

GNOME_IMAGES = 			\
	checked.png		\
	unchecked.png 		\
	start.png		\
	stop.png		\
	gtk-stop.png		\
	forward.png		\
	display.png		\
	keyboard.png		\
	cdrom.png		\
	network.png		\
	drive-harddisk.png	\
	network-server.png	\
	connect_established.png	\
	computer-template.png   \
	computer.png

IMAGES = $(GNOME_IMAGES)	\
	virt-viewer.png		\
	tigervnc.png		\
	novnc.png		\
	xtermjs.png		\
	favicon.ico		\
	snapshot.png		\
	computer-on.png		\
	memory.png		\
	processor.png		\
	proxmox_logo.png	\
	pve-electrified_logo.png \
	pve-electrified_logo_30x172.png \
	network-server-on.png	\
	network-server-off.png	\
	lxc-on.png		\
	lxc-off.png		\
	openvz-on.png		\
	openvz-off.png		\
	blank.gif		\
	swap.png		\
	icon-swap.png		\
	icon-cd.png		\
	icon-network.png	\
	icon-display.png	\
	icon-harddisk.png	\
	icon-keyboard.png	\
	logo-ceph.png		\
	logo-128.png		\
	icon-serial.svg		\
	icon-cloud.svg		\
	icon-pci.svg		\
	icon-usb.png 		\
	icon-die.svg		\
	icon-sdn.svg		\
	icon-fa-network-wired.svg\
	icon-cpu.svg		\
	icon-memory.svg		\
	icon-cd-drive.svg	\


icon-sdn.svg: icon-sdn.dot
	fdp -Tsvg $< > $@

.PHONY: install 
install: $(IMAGES)
	install -d $(WWWIMAGEDIR)
	install -m 0644 $(IMAGES) $(WWWIMAGEDIR)

.PHONY: clean
clean:
	rm -rf *~
