Ext.define('PVE.storage.ImageView', {
    extend: 'PVE.storage.ContentView',

    alias: 'widget.pveStorageImageView',

    initComponent: function () {
        var me = this;

        var nodename = (me.nodename = me.pveSelNode.data.node);
        if (!me.nodename) {
            throw 'no node name specified';
        }

        var storage = (me.storage = me.pveSelNode.data.storage);
        if (!me.storage) {
            throw 'no storage ID specified';
        }

        if (!me.content || (me.content !== 'images' && me.content !== 'rootdir')) {
            throw "content needs to be either 'images' or 'rootdir'";
        }

        var sm = (me.sm = Ext.create('Ext.selection.RowModel', {}));

        var reload = function () {
            me.store.load();
        };

        me.tbar = [
            {
                xtype: 'proxmoxButton',
                selModel: sm,
                text: gettext('Remove'),
                disabled: true,
                handler: function (btn, event, rec) {
                    let url = `/nodes/${nodename}/storage/${storage}/content/${rec.data.volid}`;
                    var vmid = rec.data.vmid;

                    var store = PVE.data.ResourceStore;

                    if (vmid && store.findVMID(vmid)) {
                        let guest_node = store.guestNode(vmid);
                        let storage_path = 'storage/' + nodename + '/' + storage;

                        // allow to delete local backed images if a VMID exists on another node.
                        if (store.storageIsShared(storage_path) || guest_node === nodename) {
                            let msg = Ext.String.format(
                                gettext("Cannot remove image, a guest with VMID '{0}' exists!"),
                                vmid,
                            );
                            msg +=
                                '<br />' +
                                gettext("You can delete the image from the guest's hardware pane");

                            Ext.Msg.show({
                                title: gettext('Cannot remove disk image.'),
                                icon: Ext.Msg.ERROR,
                                msg: msg,
                            });
                            return;
                        }
                    }
                    var win = Ext.create('Proxmox.window.SafeDestroy', {
                        title: Ext.String.format(gettext("Destroy '{0}'"), rec.data.volid),
                        showProgress: true,
                        url: url,
                        item: { type: 'Image', id: vmid },
                        taskName: 'unknownimgdel',
                    }).show();
                    win.on('destroy', reload);
                },
            },
        ];
        me.useCustomRemoveButton = true;

        me.extraColumns = {
            guest: {
                header: gettext('Guest'),
                flex: 1,
                dataIndex: 'vmid',
                renderer: function (vmid) {
                    if (!vmid) {
                        return '';
                    }
                    let name = PVE.data.ResourceStore.guestName(vmid);
                    if (name && name !== '-') {
                        return PVE.Utils.getFormattedGuestIdentifier(vmid, name);
                    }
                    return String(vmid);
                },
            },
            guestAction: {
                xtype: 'actioncolumn',
                header: '',
                width: 30,
                items: [
                    {
                        iconCls: 'fa fa-chevron-right',
                        tooltip: gettext('Go to Guest'),
                        isActionDisabled: (_view, _ri, _ci, _item, { data }) =>
                            !data.vmid || !PVE.data.ResourceStore.findVMID(data.vmid),
                        handler: function (view, _ri, _ci, _item, _e, { data }) {
                            let index = PVE.data.ResourceStore.findExact(
                                'vmid',
                                parseInt(data.vmid, 10),
                            );
                            if (index < 0) {
                                return;
                            }
                            let guest = PVE.data.ResourceStore.getAt(index).data;
                            let isQemu = guest.type === 'qemu';
                            let sp = Ext.state.Manager.getProvider();
                            if (isQemu) {
                                sp.set('kvmtab', { value: 'hardware' });
                            } else {
                                sp.set('lxctab', { value: 'resources' });
                            }
                            let ws = view.up('pveStdWorkspace');
                            ws.selectById(guest.id);
                            let itemId = isQemu ? 'hardware' : 'resources';
                            let grid = ws.down('#' + itemId);
                            if (grid) {
                                grid.pendingVolid = data.volid;
                            }
                        },
                    },
                ],
            },
        };

        me.callParent();
    },
});
