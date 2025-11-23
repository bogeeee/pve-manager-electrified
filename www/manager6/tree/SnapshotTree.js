Ext.define('PVE.guest.SnapshotTree', {
    extend: 'Ext.tree.Panel',
    xtype: 'pveGuestSnapshotTree',

    stateful: true,
    stateId: 'grid-snapshots',

    viewModel: {
        data: {
            // should be 'qemu' or 'lxc'
            type: undefined,
            nodename: undefined,
            vmid: undefined,
            vmname: undefined,
            snapshotAllowed: false,
            rollbackAllowed: false,
            snapshotFeature: false,
            running: false,
            selected: '',
            load_delay: 3000,
        },
        formulas: {
            canSnapshot: (get) => get('snapshotAllowed') && get('snapshotFeature'),
            canRollback: (get) => get('rollbackAllowed') && get('isSnapshot'),
            canRemove: (get) => get('snapshotAllowed') && get('isSnapshot'),
            isSnapshot: (get) => get('selected') && get('selected') !== 'current',
            buttonText: (get) => (get('snapshotAllowed') ? gettext('Edit') : gettext('View')),
            showMemory: (get) => get('type') === 'qemu',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        newSnapshot: function () {
            this.run_editor(false);
        },

        editSnapshot: function () {
            this.run_editor(true);
        },

        run_editor: function (edit) {
            let me = this;
            let vm = me.getViewModel();
            let snapname;
            if (edit) {
                snapname = vm.get('selected');
                if (!snapname || snapname === 'current') {
                    return;
                }
            }
            let win = Ext.create('PVE.window.Snapshot', {
                nodename: vm.get('nodename'),
                vmid: vm.get('vmid'),
                vmname: vm.get('vmname'),
                viewonly: !vm.get('snapshotAllowed'),
                type: vm.get('type'),
                isCreate: !edit,
                submitText: !edit ? gettext('Take Snapshot') : undefined,
                snapname: snapname,
                running: vm.get('running'),
            });
            win.show();
            me.mon(win, 'destroy', me.reload, me);
        },

        snapshotAction: function (action, method) {
            let me = this;
            let view = me.getView();
            let vm = me.getViewModel();
            let snapname = vm.get('selected');
            if (!snapname) {
                return;
            }

            let nodename = vm.get('nodename');
            let type = vm.get('type');
            let vmid = vm.get('vmid');

            Proxmox.Utils.API2Request({
                url: `/nodes/${nodename}/${type}/${vmid}/snapshot/${snapname}/${action}`,
                method: method,
                waitMsgTarget: view,
                callback: function () {
                    me.reload();
                },
                failure: function (response, opts) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
                success: function (response, options) {
                    var upid = response.result.data;
                    var win = Ext.create('Proxmox.window.TaskProgress', { upid: upid });
                    win.show();
                },
            });
        },

        rollback: function () {
            this.snapshotAction('rollback', 'POST');
        },
        remove: function () {
            this.snapshotAction('', 'DELETE');
        },
        cancel: function () {
            this.load_task.cancel();
        },

        reload: function () {
            let me = this;
            let view = me.getView();
            let vm = me.getViewModel();
            let nodename = vm.get('nodename');
            let vmid = vm.get('vmid');
            let type = vm.get('type');
            let load_delay = vm.get('load_delay');

            Proxmox.Utils.API2Request({
                url: `/nodes/${nodename}/${type}/${vmid}/snapshot`,
                method: 'GET',
                failure: function (response, opts) {
                    if (me.destroyed) {
                        return;
                    }
                    Proxmox.Utils.setErrorMask(view, response.htmlStatus);
                    me.load_task.delay(load_delay);
                },
                success: function (response, opts) {
                    if (me.destroyed) {
                        // this is in a delayed task, avoid dragons if view has
                        // been destroyed already and go home.
                        return;
                    }
                    Proxmox.Utils.setErrorMask(view, false);
                    var digest = 'invalid';
                    var idhash = {};
                    var root = { name: '__root', expanded: true, children: [] };
                    Ext.Array.each(response.result.data, function (item) {
                        item.leaf = true;
                        item.children = [];
                        if (item.name === 'current') {
                            vm.set('running', !!item.running);
                            digest = item.digest + item.running;
                            item.iconCls = PVE.Utils.get_object_icon_class(vm.get('type'), item);
                        } else {
                            item.iconCls = 'fa fa-fw fa-history x-fa-tree';
                        }
                        idhash[item.name] = item;
                    });

                    if (digest !== me.old_digest) {
                        me.old_digest = digest;

                        Ext.Array.each(response.result.data, function (item) {
                            if (item.parent && idhash[item.parent]) {
                                let parent_item = idhash[item.parent];
                                parent_item.children.push(item);
                                parent_item.leaf = false;
                                parent_item.expanded = true;
                                parent_item.expandable = false;
                            } else {
                                root.children.push(item);
                            }
                        });

                        me.getView().setRootNode(root);
                    }

                    me.load_task.delay(load_delay);
                },
            });

            // if we do not have the permissions, we don't have to check
            // if we can create a snapshot, since the butten stays disabled
            if (!vm.get('snapshotAllowed')) {
                return;
            }

            Proxmox.Utils.API2Request({
                url: `/nodes/${nodename}/${type}/${vmid}/feature`,
                params: { feature: 'snapshot' },
                method: 'GET',
                success: function (response, options) {
                    if (me.destroyed) {
                        // this is in a delayed task, the current view could been
                        // destroyed already; then we mustn't do viemodel set
                        return;
                    }
                    let res = response.result.data;
                    vm.set('snapshotFeature', !!res.hasFeature);
                },
            });
        },

        select: function (grid, val) {
            let vm = this.getViewModel();
            if (val.length < 1) {
                vm.set('selected', '');
                return;
            }
            vm.set('selected', val[0].data.name);
        },

        init: function (view) {
            let me = this;
            let vm = me.getViewModel();
            me.load_task = new Ext.util.DelayedTask(me.reload, me);

            if (!view.type) {
                throw 'guest type not set';
            }
            vm.set('type', view.type);

            if (!view.pveSelNode.data.node) {
                throw 'no node name specified';
            }
            vm.set('nodename', view.pveSelNode.data.node);

            if (!view.pveSelNode.data.vmid) {
                throw 'no VM ID specified';
            }
            vm.set('vmid', view.pveSelNode.data.vmid);

            vm.set('vmname', view.pveSelNode.data.name);

            let caps = Ext.state.Manager.get('GuiCap');
            vm.set('snapshotAllowed', !!caps.vms['VM.Snapshot']);
            vm.set('rollbackAllowed', !!caps.vms['VM.Snapshot.Rollback']);

            view.getStore().sorters.add({
                property: 'order',
                direction: 'ASC',
            });

            me.reload();
        },
    },

    listeners: {
        selectionchange: 'select',
        itemdblclick: 'editSnapshot',
        beforedestroy: 'cancel',
    },

    layout: 'fit',
    rootVisible: false,
    animate: false,
    sortableColumns: false,

    tbar: [
        {
            xtype: 'proxmoxButton',
            text: gettext('Take Snapshot'),
            disabled: true,
            bind: {
                disabled: '{!canSnapshot}',
            },
            handler: 'newSnapshot',
        },
        '-',
        {
            xtype: 'proxmoxButton',
            text: gettext('Rollback'),
            disabled: true,
            bind: {
                disabled: '{!canRollback}',
            },
            confirmMsg: function () {
                let view = this.up('treepanel');
                let rec = view.getSelection()[0];
                let vmid = view.getViewModel().get('vmid');
                let vmname = view.getViewModel().get('vmname');
                let message =
                    PVE.Utils.formatGuestTaskConfirmation('qmrollback', vmid, vmname) +
                    ` '${rec.data.name}'? ${gettext('Current state will be lost.')}`;
                return Ext.htmlEncode(message);
            },
            handler: 'rollback',
        },
        '-',
        {
            xtype: 'proxmoxButton',
            text: gettext('Edit'),
            bind: {
                text: '{buttonText}',
                disabled: '{!isSnapshot}',
            },
            disabled: true,
            edit: true,
            handler: 'editSnapshot',
        },
        {
            xtype: 'proxmoxButton',
            text: gettext('Remove'),
            disabled: true,
            dangerous: true,
            bind: {
                disabled: '{!canRemove}',
            },
            confirmMsg: function () {
                let view = this.up('treepanel');
                let { data } = view.getSelection()[0];
                return Ext.String.format(
                    gettext('Are you sure you want to remove entry {0}'),
                    `'${data.name}'`,
                );
            },
            handler: 'remove',
        },
        {
            xtype: 'label',
            text: gettext('The current guest configuration does not support taking new snapshots'),
            hidden: true,
            bind: {
                hidden: '{canSnapshot}',
            },
        },
    ],

    columnLines: true,

    fields: [
        'name',
        'description',
        'snapstate',
        'vmstate',
        'running',
        { name: 'snaptime', type: 'date', dateFormat: 'timestamp' },
        {
            name: 'order',
            calculate: function (data) {
                return data.snaptime || (data.name === 'current' ? 'ZZZ' : data.snapstate);
            },
        },
    ],

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('Name'),
            dataIndex: 'name',
            width: 200,
            renderer: (value, _, { data }) => (data.name !== 'current' ? value : gettext('NOW')),
        },
        {
            text: gettext('RAM'),
            hidden: true,
            bind: {
                hidden: '{!showMemory}',
            },
            align: 'center',
            resizable: false,
            dataIndex: 'vmstate',
            width: 50,
            renderer: (value, _, { data }) =>
                data.name !== 'current' ? Proxmox.Utils.format_boolean(value) : '',
        },
        {
            text: gettext('Date') + '/' + gettext('Status'),
            dataIndex: 'snaptime',
            width: 150,
            renderer: function (value, metaData, record) {
                if (record.data.snapstate) {
                    return record.data.snapstate;
                } else if (value) {
                    return Ext.Date.format(value, 'Y-m-d H:i:s');
                }
                return '';
            },
        },
        {
            text: gettext('Description'),
            dataIndex: 'description',
            flex: 1,
            renderer: function (value, metaData, record) {
                if (record.data.name === 'current') {
                    return gettext('You are here!');
                } else {
                    return Ext.String.htmlEncode(value);
                }
            },
        },
    ],
});
