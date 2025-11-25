include /usr/share/dpkg/default.mk
include defines.mk
-include local.config.mk

.PHONY: local.config.mk
local.config.mk:
	test -f local.config.mk || (echo "local.config.mk does not exist (on the IDE machine). See development-readme.md" && exit 1)


export PVERELEASE = $(shell echo $(DEB_VERSION_UPSTREAM) | cut -d. -f1-2)
export VERSION = $(DEB_VERSION_UPSTREAM_REVISION)

BUILD_TOOLS=/usr/bin/mk-build-deps /usr/bin/sq /usr/share/pve-doc-generator

BUILDDIR = build
DEBIAN_DISTRIBUTION=trixie

DSC=$(PACKAGE)_$(DEB_VERSION).dsc
DEB=$(PACKAGE)_$(DEB_VERSION)_all.deb

DESTDIR=
SUBDIRS = aplinfo nodejsserver PVE bin www services configs network-hooks test templates
EXEC_SSH_TARGT_PVE_HOST=@sshpass -p "$(TARGT_PVE_HOST_ROOTPASSWORD)" ssh root@$(TARGT_PVE_HOST)

# Installs the required build tools
# Note: The /root/proxmox/pve-manager-electrified directory is created by IDE_rsync_project_to_targt_pve_host
$(BUILD_TOOLS):
	apt-get install -y build-essential git git-email debhelper pve-doc-generator
	mk-build-deps --install

# Default = with delete
RSYNC_PARAMS=--delete

all: $(SUBDIRS)
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i; done

.PHONY: tidy
tidy:
	git ls-files ':*.p[ml]'| xargs -n4 -P0 proxmox-perltidy
	$(MAKE) -C bin tidy
	$(MAKE) -C www tidy

.PHONY: check
check: bin test www
	$(MAKE) -C bin check
	$(MAKE) -C test check
	$(MAKE) -C www check

GITVERSION:=$(shell git rev-parse --short=16 HEAD)
$(BUILDDIR):
	rm -rf $@ $@.tmp
	mkdir $@.tmp
	rsync -a --exclude=$@.tmp * $@.tmp
	echo "git clone git://git.proxmox.com/git/pve-manager.git\\ngit checkout $(GITVERSION)" >  $@.tmp/debian/SOURCE
	echo "REPOID_GENERATED=$(GITVERSION)" > $@.tmp/debian/rules.env
	mv $@.tmp $@

.PHONY: deb dsc
deb: $(DEB)
$(DEB): $(BUILDDIR)
	cd $(BUILDDIR); dpkg-buildpackage -b -us -uc
	lintian $(DEB)

dsc:
	rm -rf $(BUILDDIR) $(DSC)
	$(MAKE) $(DSC)
	lintian $(DSC)
$(DSC): $(BUILDDIR)
	cd $(BUILDDIR); dpkg-buildpackage -S -us -uc -d

sbuild: $(DSC)
	sbuild $<


.PHONY: install
install: vzdump-hook-script.pl $(BUILD_TOOLS)
	install -d -m 0700 -o www-data -g www-data $(DESTDIR)/var/log/pveproxy
	install -d $(DOCDIR)/examples
	install -d $(DESTDIR)/var/lib/$(PACKAGE)
	install -d $(DESTDIR)/var/lib/vz/images
	install -d $(DESTDIR)/var/lib/vz/template/cache
	install -d $(DESTDIR)/var/lib/vz/template/iso
	install -m 0644 vzdump-hook-script.pl $(DOCDIR)/examples/vzdump-hook-script.pl
	install -m 0644 spice-example-sh $(DOCDIR)/examples/spice-example-sh
	install -d ${UIPLUGINEXAMPLEDIR}
	install -m 0644 ui-plugin-example/* ${UIPLUGINEXAMPLEDIR}
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i $@; done

.PHONY: distclean
distclean: clean

.PHONY: clean
clean:
	set -e && for i in $(SUBDIRS); do $(MAKE) -C $$i $@; done
	rm -f $(PACKAGE)*.tar* *.deb *.dsc *.build *.buildinfo *.changes
	rm -rf dest $(PACKAGE)-[0-9]*/
	rm -rf $(BUILDDIR).tmp
	rm -rf $(BUILDDIR)
	rm -f index.html


.PHONY: dinstall
dinstall: $(DEB)
	dpkg -i $(DEB)

index.html: readme.md docs/github-pandoc.css /usr/bin/pandoc
	pandoc --css=docs/github-pandoc.css -s -f markdown -t html --metadata "pagetitle=PVE electrified" readme.md > index.html

###################################################################################
# IDE_... targets are to be run on the machine where the IDE is (not the pve-host)
###################################################################################

# prepares everything and starts the nodejs server on the pve server in debug mode.
# Forwards the debugging port, so you can remote debug from the IDE
# Also forwards the web ports (might be handy)
# See also the faster alternative below, if this one gives too long roundtrips
.PHONY: IDE_develop_nodejsserver
IDE_develop_nodejsserver: IDE_rsync_project_to_targt_pve_host
	#Quick check, if the .ts files compile:
	npm --prefix nodejsserver run check

	$(EXEC_SSH_TARGT_PVE_HOST) -L 9229:localhost:9229 -L 8006:localhost:8006 -L 8005:ip6-localhost:8005 "\
	cd /root/proxmox/pve-manager-electrified || exit; \
	rm -f local.config.mk; \
	systemctl stop pveproxy.service || exit; \
    make install || exit; \
    systemctl daemon-reload || exit; \
    echo starting pveproxy.service - this may take a while; \
    systemctl restart pveproxy.service || exit; \
	cd nodejsserver; \
	npm run dev; \
	exit; \
	";

# Like the above, but skips some steps
.PHONY: IDE_faster_develop_nodejsserver
IDE_faster_develop_nodejsserver:
	$(MAKE) IDE_rsync_project_to_targt_pve_host RSYNC_PARAMS=
	#Quick check, if the .ts files compile:
	npm --prefix nodejsserver run check

	$(EXEC_SSH_TARGT_PVE_HOST) -L 9229:localhost:9229 "\
	cd /root/proxmox/pve-manager-electrified || exit; \
	rm -f local.config.mk; \
	cd nodejsserver; \
	npm run dev; \
	exit; \
	";

# prepares everything and starts the nodejs server on the pve server in production mode.
# Run this for a smoke test before publishing the debian package
.PHONY: IDE_prod_run_nodejsserver
IDE_prod_run_nodejsserver: IDE_rsync_project_to_targt_pve_host
	#Quick check, if the .ts files compile:
	npm --prefix nodejsserver run check

	$(EXEC_SSH_TARGT_PVE_HOST) -L 8006:localhost:8006 -L 8005:ip6-localhost:8005 "\
	cd /root/proxmox/pve-manager-electrified; \
	rm -f local.config.mk; \
	systemctl stop pveproxy.service; \
    make install; \
    systemctl daemon-reload; \
    systemctl restart pveproxy.service;\
	cd nodejsserver; \
	npm run start; \
	";


.PHONY: IDE_rsync_project_to_targt_pve_host
IDE_rsync_project_to_targt_pve_host: local.config.mk
	$(EXEC_SSH_TARGT_PVE_HOST) mkdir -p /root/proxmox/pve-manager-electrified
	@sshpass -p "$(TARGT_PVE_HOST_ROOTPASSWORD)" rsync -a $(RSYNC_PARAMS) --exclude="**/node_modules" . root@$(TARGT_PVE_HOST):/root/proxmox/pve-manager-electrified/

.PHONY: IDE_publish_docs_to_website
IDE_publish_docs_to_website: local.config.mk clean index.html /usr/bin/sshpass
	@sshpass -p "$(REPO_SERVER_PASSWORD)" rsync  -a index.html pubkey.asc docs www/images/favicon.ico pve-electrified.net@pve-electrified.net:httpdocs

# Creates a local aptly repo on the IDE machine (if needed). Aptly offers an easy way, to generate the static files for publishing to a webserver.
# See also [this blogpost about running an apt repo with aptly](https://perlgeek.de/blog-en/automating-deployments/2016-006-distributing-packages.html)
.PHONY: IDE_create_aptly_repo
IDE_create_aptly_repo: local.config.mk /usr/bin/aptly
	@if ! echo "$$(aptly repo list -raw)" | grep -q "pve-electrified-$(DEBIAN_DISTRIBUTION)"; then \
  	  echo "** creating aptly repo: pve-electrified-$(DEBIAN_DISTRIBUTION) **"; \
	  aptly repo create -distribution=$(DEBIAN_DISTRIBUTION) -component=main "pve-electrified-$(DEBIAN_DISTRIBUTION)"; \
	fi

	@if ! echo "$$(aptly publish list -raw)" | grep -q "$(DEBIAN_DISTRIBUTION)"; then \
	  aptly publish repo -architectures=amd64 -gpg-key=$(REPO_PUBLISH-KEY-ID) -keyring=$(REPO_PUBLISH-PUBLIC-KEY-FILE) -secret-keyring=$(REPO_PUBLISH-SECRET-KEY-FILE) "pve-electrified-$(DEBIAN_DISTRIBUTION)"; \
	fi

# ...
# See also: IDE_prod_run_nodejsserver, which you should run as a smoke test before publishing
.PHONY: IDE_build_and_publish_package
IDE_build_and_publish_package: local.config.mk IDE_create_aptly_repo /usr/bin/sshpass /usr/bin/aptly IDE_rsync_project_to_targt_pve_host
	# Build on the pve server:
	$(EXEC_SSH_TARGT_PVE_HOST) "cd /root/proxmox/pve-manager-electrified && make clean && make deb"
	# copy .deb to this machine:
	@sshpass -p "$(TARGT_PVE_HOST_ROOTPASSWORD)" rsync -a root@$(TARGT_PVE_HOST):/root/proxmox/pve-manager-electrified/$(DEB) .
	aptly repo add "pve-electrified-$(DEBIAN_DISTRIBUTION)" $(DEB)
	aptly publish update -gpg-key=$(REPO_PUBLISH-KEY-ID) -keyring=$(REPO_PUBLISH-PUBLIC-KEY-FILE) -secret-keyring=$(REPO_PUBLISH-SECRET-KEY-FILE) $(DEBIAN_DISTRIBUTION)
	echo "Uploading to $(REPO_PUBLISH_DESTINATION)"
	@sshpass -p "$(REPO_SERVER_PASSWORD)" rsync -a /home/user/.aptly/public/* $(REPO_PUBLISH_DESTINATION)


/usr/bin/pandoc:
	apt install -y pandoc
/usr/bin/aptly:
	apt install -y aptly
/usr/bin/sshpass:
	apt install -y sshpass