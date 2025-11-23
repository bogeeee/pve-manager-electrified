Ext.define('PVE.GuestStop', {
    extend: 'Ext.window.MessageBox',

    closeAction: 'destroy',

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.vm) {
            throw 'no vm specified';
        }

        let isQemuVM = me.vm.type === 'qemu';
        let overruleTaskType = isQemuVM ? 'qmshutdown' : 'vzshutdown';

        me.taskType = isQemuVM ? 'qmstop' : 'vzstop';
        me.url = `/nodes/${me.nodename}/${me.vm.type}/${me.vm.vmid}/status/stop`;

        let caps = Ext.state.Manager.get('GuiCap');
        let hasSysModify = !!caps.nodes['Sys.Modify'];

        // offer to overrule if there is at least one matching shutdown task and the guest is not
        // HA-enabled. Also allow users to abort tasks started by one of their API tokens.
        let activeShutdownTask =
            Ext.getStore('pve-cluster-tasks')?.findBy(
                (task) =>
                    (hasSysModify || task.data.user === Proxmox.UserName) &&
                    task.data.id === me.vm.vmid.toString() &&
                    task.data.status === undefined &&
                    task.data.type === overruleTaskType,
            ) !== -1;
        let haEnabled = me.vm.hastate && me.vm.hastate !== 'unmanaged';

        me.callParent();

        // message box has its actual content in a sub-container, the top one is just for layouting
        me.promptContainer.add({
            xtype: 'proxmoxcheckbox',
            name: 'overrule-shutdown',
            checked: !haEnabled && activeShutdownTask,
            boxLabel: gettext('Overrule active shutdown tasks'),
            hidden: !(hasSysModify || activeShutdownTask),
            disabled: !(hasSysModify || activeShutdownTask) || haEnabled,
            padding: '3 0 0 0',
        });
    },

    handler: function (btn) {
        let me = this;
        if (btn === 'yes') {
            let overruleField = me.promptContainer.down('proxmoxcheckbox[name=overrule-shutdown]');
            let params =
                !overruleField.isDisabled() && overruleField.getSubmitValue()
                    ? { 'overrule-shutdown': 1 }
                    : undefined;
            Proxmox.Utils.API2Request({
                url: me.url,
                waitMsgTarget: me,
                method: 'POST',
                params: params,
                failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
            });
        }
    },

    show: function () {
        let me = this;
        let cfg = {
            title: gettext('Confirm'),
            icon: Ext.Msg.WARNING,
            msg: PVE.Utils.formatGuestTaskConfirmation(me.taskType, me.vm.vmid, me.vm.name),
            buttons: Ext.Msg.YESNO,
            callback: (btn) => me.handler(btn),
        };
        me.callParent([cfg]);
    },
});
