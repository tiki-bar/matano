FROM gitpod/workspace-full:latest

RUN echo "START" && \
    sudo apt install -y mpg123 && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    sudo ./aws/install && \
    rm -rf awscliv2.zip aws && \
    npm install -g aws-cdk && \
    python -m pip install --user pipx && python -m pipx ensurepath && \
    pipx install gTTS && pipx install yawsso && \
    bash -c ". /home/gitpod/.sdkman/bin/sdkman-init.sh \
             && sdk install kotlin 1.7.0 \
             && sdk install spark 3.2.1" && \
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" && \
    git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions && \
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting && \
    echo "DONE!"
