Ext.define('PVE.storage.Browser', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.storage.Browser',

    onlineHelp: 'chapter_storage',

    initComponent: function () {
        let me = this;

        let nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        let storeid = me.pveSelNode.data.storage;
        if (!storeid) {
            throw 'no storage ID specified';
        }

        let storageInfo = PVE.data.ResourceStore.findRecord(
            'id',
            `storage/${nodename}/${storeid}`,
            0, // startIndex
            false, // anyMatch
            true, // caseSensitive
            true, // exactMatch
        );
        let res = storageInfo.data;
        let plugin = res.plugintype;

        let isEsxi = plugin === 'esxi';

        me.items = !isEsxi
            ? [
                  {
                      title: gettext('Summary'),
                      xtype: 'pveStorageSummary',
                      iconCls: 'fa fa-book',
                      itemId: 'summary',
                  },
              ]
            : [];

        let caps = Ext.state.Manager.get('GuiCap');

        Ext.apply(me, {
            title: Ext.String.format(
                gettext('Storage {0} on node {1}'),
                `'${storeid}'`,
                `'${nodename}'`,
            ),
            hstateid: 'storagetab',
        });

        if (
            caps.storage['Datastore.Allocate'] ||
            caps.storage['Datastore.AllocateSpace'] ||
            caps.storage['Datastore.Audit']
        ) {
            let contents = res.content.split(',');

            let enableUpload = !!caps.storage['Datastore.AllocateTemplate'];
            let enableDownloadUrl =
                enableUpload &&
                (!!(caps.nodes['Sys.Audit'] && caps.nodes['Sys.Modify']) || // for backward compat
                    !!caps.nodes['Sys.AccessNetwork']); // new explicit priv for querying (local) networks

            if (contents.includes('backup')) {
                me.items.push({
                    xtype: 'pveStorageBackupView',
                    title: gettext('Backups'),
                    iconCls: 'fa fa-floppy-o',
                    itemId: 'contentBackup',
                    pluginType: plugin,
                });
            }
            if (contents.includes('images')) {
                me.items.push({
                    xtype: 'pveStorageImageView',
                    title: gettext('VM Disks'),
                    iconCls: 'fa fa-hdd-o',
                    itemId: 'contentImages',
                    content: 'images',
                    pluginType: plugin,
                });
            }
            if (contents.includes('rootdir')) {
                me.items.push({
                    xtype: 'pveStorageImageView',
                    title: gettext('CT Volumes'),
                    iconCls: 'fa fa-hdd-o lxc',
                    itemId: 'contentRootdir',
                    content: 'rootdir',
                    pluginType: plugin,
                });
            }
            if (contents.includes('iso')) {
                me.items.push({
                    xtype: 'pveStorageContentView',
                    title: gettext('ISO Images'),
                    iconCls: 'pve-itype-treelist-item-icon-cdrom',
                    itemId: 'contentIso',
                    content: 'iso',
                    pluginType: plugin,
                    enableUploadButton: enableUpload,
                    enableDownloadUrlButton: enableDownloadUrl,
                    useUploadButton: true,
                });
            }
            if (contents.includes('vztmpl')) {
                me.items.push({
                    xtype: 'pveStorageTemplateView',
                    title: gettext('CT Templates'),
                    iconCls: 'fa fa-file-o lxc',
                    itemId: 'contentVztmpl',
                    pluginType: plugin,
                    enableUploadButton: enableUpload,
                    enableDownloadUrlButton: enableDownloadUrl,
                    useUploadButton: true,
                });
            }
            if (contents.includes('snippets')) {
                me.items.push({
                    xtype: 'pveStorageContentView',
                    title: gettext('Snippets'),
                    iconCls: 'fa fa-file-code-o',
                    itemId: 'contentSnippets',
                    content: 'snippets',
                    pluginType: plugin,
                });
            }
            if (contents.includes('import')) {
                let isImportable = (format) =>
                    ['ova', 'ovf', 'vmx', 'raw', 'qcow2', 'vmdk'].indexOf(format) !== -1;
                let createGuestImportWindow = (selection) => {
                    if (!selection) {
                        return;
                    }

                    let volumeName = selection.data.volid.replace(/^.*?:/, '');

                    if (['raw', 'vmdk', 'qcow2'].indexOf(selection.data.format) !== -1) {
                        Ext.create('PVE.qemu.HDImportEdit', {
                            selection: selection.data.volid,
                            nodename,
                            autoShow: true,
                        });
                    } else {
                        Ext.create('PVE.window.GuestImport', {
                            storage: storeid,
                            volumeName,
                            nodename,
                            autoShow: true,
                        });
                    }
                };
                me.items.push({
                    xtype: 'pveStorageContentView',
                    // each gettext needs to be in a separate line
                    title: isEsxi ? gettext('Virtual Guests') : gettext('Import'),
                    iconCls: isEsxi ? 'fa fa-desktop' : 'fa fa-cloud-download',
                    itemId: 'contentImport',
                    content: 'import',
                    useCustomRemoveButton: isEsxi, // hide default remove button for esxi
                    showColumns: isEsxi ? ['name', 'format'] : ['name', 'size', 'format'],
                    enableUploadButton: enableUpload && !isEsxi,
                    enableDownloadUrlButton: enableDownloadUrl && !isEsxi,
                    useUploadButton: !isEsxi,
                    itemdblclick: (view, record) => {
                        if (isImportable(record.data.format)) {
                            createGuestImportWindow(record);
                        }
                    },
                    tbar: [
                        {
                            xtype: 'proxmoxButton',
                            disabled: true,
                            text: gettext('Import'),
                            iconCls: 'fa fa-cloud-download',
                            enableFn: (rec) => isImportable(rec.data.format),
                            handler: function () {
                                let grid = this.up('pveStorageContentView');
                                let selection = grid.getSelection()?.[0];

                                createGuestImportWindow(selection);
                            },
                        },
                    ],
                    pluginType: plugin,
                });
            }
        }

        if (caps.storage['Permissions.Modify']) {
            me.items.push({
                xtype: 'pveACLView',
                title: gettext('Permissions'),
                iconCls: 'fa fa-unlock',
                itemId: 'permissions',
                path: `/storage/${storeid}`,
            });
        }

        me.callParent();
    },
});
